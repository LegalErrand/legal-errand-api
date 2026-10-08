import { Response } from "express";
import { Types } from "mongoose";
import { AdminRequest } from "../../types";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import {
  Firm,
  FirmAccessGrant,
  FirmMember,
  FirmNote,
  Invoice,
  Payment,
  Subscription,
  SupportTicket,
  isGrantUsable,
  ACCESS_GRANT_TTL_MS,
} from "../../models/firm";
import { env } from "../../config/env";
import { emailService } from "../../services/email/email.service";

const sha256 = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");
import { FirmPlan, isFirmPlan, listPriceFor, seatsFor } from "../../config/plans";
import { recordAdminAction, adminNameFor } from "../../services/firm/audit.service";
import { sendSuccess, sendNotFound, sendError } from "../../utils/response";

const DAY_MS = 86_400_000;
/** How long a trial extension buys a firm. One week, every time. */
const TRIAL_EXTENSION_DAYS = 7;

/** Loads a firm and its subscription, or answers 404 once for both. */
async function loadFirm(req: AdminRequest, res: Response) {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) {
    sendNotFound(res, "Firm not found");
    return null;
  }
  const firm = await Firm.findById(id);
  if (!firm) {
    sendNotFound(res, "Firm not found");
    return null;
  }
  const subscription = await Subscription.findOne({ firmId: firm._id });
  return { firm, subscription };
}

/**
 * PATCH /admin/firms/:id/plan
 *
 * Moving a firm between plans. Seats and price follow the catalogue, except on
 * Enterprise, where the price is whatever was negotiated and must be passed in.
 */
export const changePlan = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const loaded = await loadFirm(req, res);
    if (!loaded) return;
    const { firm, subscription } = loaded;

    const { plan, mrr, seats } = req.body as { plan?: string; mrr?: number; seats?: number };
    if (!isFirmPlan(plan)) {
      sendError(res, "Unknown plan", 400, "plan must be starter, practice, firm or enterprise");
      return;
    }
    if (!subscription) {
      sendError(res, "This firm has no subscription yet", 409);
      return;
    }
    // Enterprise has no list price, so moving a firm onto it without saying what
    // they agreed would quietly set their MRR to zero.
    if (plan === "enterprise" && (mrr === undefined || mrr === null)) {
      sendError(res, "Enterprise needs an agreed price", 400, "Pass mrr, in naira");
      return;
    }
    if (mrr !== undefined && (typeof mrr !== "number" || mrr < 0)) {
      sendError(res, "mrr must be a number of naira, zero or more", 400);
      return;
    }

    const was = subscription.plan;
    if (was === plan && mrr === undefined && seats === undefined) {
      sendSuccess(res, { plan }, "Already on that plan");
      return;
    }

    const seatsInUse = await FirmMember.countDocuments({ firmId: firm._id, isActive: true });
    // Never leave a firm with fewer seats than people already using it.
    const nextSeats = Math.max(seats ?? seatsFor(plan), seatsInUse);

    subscription.plan = plan;
    subscription.seats = nextSeats;
    // A trial keeps paying nothing until it ends, whatever plan it is on.
    subscription.mrr = subscription.status === "trialing" ? 0 : (mrr ?? listPriceFor(plan));
    await subscription.save();

    // The firm's own field now holds the catalogue's name, so it is set to the
    // plan itself rather than mapped down to a coarser one.
    if (firm.subscriptionPlan !== plan) {
      firm.subscriptionPlan = plan;
      await firm.save();
    }

    await recordAdminAction({
      admin: req.admin,
      action: `Changed plan ${was} → ${plan}`,
      firmId: firm._id as Types.ObjectId,
      firmName: firm.name,
      detail: { from: was, to: plan, seats: nextSeats, mrr: subscription.mrr },
    });

    sendSuccess(
      res,
      { plan, seats: nextSeats, mrr: subscription.mrr, status: subscription.status },
      `Plan changed to ${plan}`
    );
  } catch (err) {
    sendError(res, "Failed to change the plan", 500, (err as Error).message);
  }
};

/**
 * PATCH /admin/firms/:id/status
 *
 * Suspending a firm stops its people signing in. Reactivating puts them back
 * where they were. Both are deliberate acts by a person, so both are recorded.
 */
export const changeStatus = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const loaded = await loadFirm(req, res);
    if (!loaded) return;
    const { firm, subscription } = loaded;

    const { action, reason } = req.body as { action?: string; reason?: string };
    if (action !== "suspend" && action !== "reactivate") {
      sendError(res, "Unknown action", 400, "action must be suspend or reactivate");
      return;
    }
    if (!subscription) {
      sendError(res, "This firm has no subscription yet", 409);
      return;
    }

    if (action === "suspend") {
      if (subscription.status === "suspended") {
        sendSuccess(res, { status: "suspended" }, "Already suspended");
        return;
      }
      subscription.status = "suspended";
      subscription.suspendedAt = new Date();
      await subscription.save();
      // Turning the firm off means turning its people off; nothing else does it.
      const stopped = await FirmMember.updateMany(
        { firmId: firm._id, isActive: true },
        { $set: { isActive: false } }
      );

      await recordAdminAction({
        admin: req.admin,
        action: "Suspended the firm",
        firmId: firm._id as Types.ObjectId,
        firmName: firm.name,
        detail: { reason: reason ?? null, membersDeactivated: stopped.modifiedCount },
      });

      sendSuccess(
        res,
        { status: "suspended", membersDeactivated: stopped.modifiedCount },
        "Firm suspended"
      );
      return;
    }

    if (subscription.status !== "suspended") {
      sendSuccess(res, { status: subscription.status }, "Not suspended");
      return;
    }
    subscription.status = "active";
    subscription.suspendedAt = undefined;
    await subscription.save();
    const restored = await FirmMember.updateMany(
      { firmId: firm._id, isActive: false },
      { $set: { isActive: true } }
    );

    await recordAdminAction({
      admin: req.admin,
      action: "Reactivated the firm",
      firmId: firm._id as Types.ObjectId,
      firmName: firm.name,
      detail: { membersRestored: restored.modifiedCount },
    });

    sendSuccess(
      res,
      { status: "active", membersRestored: restored.modifiedCount },
      "Firm reactivated"
    );
  } catch (err) {
    sendError(res, "Failed to change the firm's status", 500, (err as Error).message);
  }
};

/** POST /admin/firms/:id/trial/extend — seven more days on the trial. */
export const extendTrial = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const loaded = await loadFirm(req, res);
    if (!loaded) return;
    const { firm, subscription } = loaded;

    if (!subscription || subscription.status !== "trialing") {
      sendError(res, "This firm is not on a trial", 409);
      return;
    }

    // Extend from whichever is later: a trial that lapsed yesterday should get a
    // week from today, not a week from the day it ran out.
    const from =
      subscription.trialEndsAt && subscription.trialEndsAt > new Date()
        ? subscription.trialEndsAt
        : new Date();
    const endsAt = new Date(from.getTime() + TRIAL_EXTENSION_DAYS * DAY_MS);

    subscription.trialEndsAt = endsAt;
    await subscription.save();

    await recordAdminAction({
      admin: req.admin,
      action: `Extended trial by ${TRIAL_EXTENSION_DAYS} days`,
      firmId: firm._id as Types.ObjectId,
      firmName: firm.name,
      detail: { trialEndsAt: endsAt },
    });

    sendSuccess(res, { trialEndsAt: endsAt }, "Trial extended");
  } catch (err) {
    sendError(res, "Failed to extend the trial", 500, (err as Error).message);
  }
};

/**
 * POST /admin/firms/:id/payment/retry
 *
 * Records another attempt at a failed invoice.
 *
 * There is no payment provider connected to this repo, so nothing is collected:
 * the attempt is written as pending and the response says so plainly. Pretending
 * a retry succeeded would put a firm's subscription back to active on the
 * strength of nothing at all.
 */
export const retryPayment = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const loaded = await loadFirm(req, res);
    if (!loaded) return;
    const { firm, subscription } = loaded;

    const invoice = await Invoice.findOne({ firmId: firm._id, status: "failed" }).sort({
      issuedAt: -1,
    });
    if (!invoice) {
      sendError(res, "This firm has no failed invoice to retry", 409);
      return;
    }

    const previous = await Payment.countDocuments({ invoiceId: invoice._id });
    const payment = await Payment.create({
      invoiceId: invoice._id,
      firmId: firm._id,
      provider: "manual",
      amount: invoice.amount,
      status: "pending",
      attempt: previous + 1,
      triggeredByAdminId: req.admin?.adminId,
      attemptedAt: new Date(),
    });

    await recordAdminAction({
      admin: req.admin,
      action: `Retried payment for ${invoice.number}`,
      firmId: firm._id as Types.ObjectId,
      firmName: firm.name,
      detail: { invoice: invoice.number, amount: invoice.amount, attempt: payment.attempt },
    });

    sendSuccess(
      res,
      {
        invoice: invoice.number,
        amount: invoice.amount,
        attempt: payment.attempt,
        collected: false,
        subscriptionStatus: subscription?.status ?? "unknown",
      },
      "Retry recorded. No payment provider is connected, so nothing has been collected yet.",
      202
    );
  } catch (err) {
    sendError(res, "Failed to record the retry", 500, (err as Error).message);
  }
};

/**
 * POST /admin/firms/:id/access-request
 *
 * We do not walk into a firm's workspace on our own say-so. This asks the
 * firm's managing partner, in an email they can act on without logging in,
 * and records that it was asked.
 *
 * Nothing is granted here. Approval is theirs, lasts a day, and is revocable.
 */
export const requestAccess = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const loaded = await loadFirm(req, res);
    if (!loaded) return;
    const { firm } = loaded;

    const { reason } = req.body as { reason?: string };
    const owner = await FirmMember.findOne({ firmId: firm._id, role: "managing_partner" })
      .select("name email")
      .lean();

    if (!owner) {
      sendError(
        res,
        "This firm has no managing partner to ask, so access cannot be requested",
        409
      );
      return;
    }

    // Asking again replaces the outstanding request rather than leaving the
    // owner with two live links for the same thing.
    await FirmAccessGrant.deleteMany({
      firmId: firm._id,
      adminId: req.admin?.adminId,
      status: "pending",
    });

    const decisionToken = crypto.randomBytes(32).toString("hex");
    const grant = await FirmAccessGrant.create({
      firmId: firm._id,
      adminId: req.admin?.adminId,
      adminName: req.admin?.email ?? "A LegalErrand admin",
      adminEmail: req.admin?.email ?? "",
      reason: reason ? String(reason).trim().slice(0, 500) : undefined,
      status: "pending",
      decisionTokenHash: sha256(decisionToken),
      // The link outlives the working day it was sent in, and no longer.
      decisionExpiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      requestedAt: new Date(),
    });

    await recordAdminAction({
      admin: req.admin,
      action: "Requested access to the workspace",
      firmId: firm._id as Types.ObjectId,
      firmName: firm.name,
      detail: { reason: reason ?? null, owner: owner.email, grantId: String(grant._id) },
    });

    const link = `${env.FIRM_APP_URL.replace(/\/$/, "")}/access-request/${decisionToken}`;
    const emailed = await emailService.sendFirmAccessRequest(owner.email, {
      firmName: firm.name,
      adminEmail: req.admin?.email ?? "a LegalErrand admin",
      reason: reason ? String(reason).trim() : undefined,
      link,
      hours: ACCESS_GRANT_TTL_MS / 3_600_000,
    });

    sendSuccess(
      res,
      {
        grantId: String(grant._id),
        status: "pending",
        ownerNotified: emailed,
        accessGranted: false,
        owner: { name: owner.name, email: owner.email },
      },
      emailed
        ? `Asked ${owner.name}. Nothing is granted until they approve it.`
        : `Request recorded, but the email to ${owner.email} could not be sent.`,
      202
    );
  } catch (err) {
    sendError(res, "Failed to record the access request", 500, (err as Error).message);
  }
};

/**
 * GET /admin/firms/:id/access-request — where our own request stands.
 *
 * Scoped to the calling admin: one admin cannot see or use another's grant.
 */
export const getAccessRequest = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const loaded = await loadFirm(req, res);
    if (!loaded) return;

    const grant = await FirmAccessGrant.findOne({
      firmId: loaded.firm._id,
      adminId: req.admin?.adminId,
    }).sort({ createdAt: -1 });

    if (!grant) {
      sendSuccess(res, { grant: null }, "No access has been asked for");
      return;
    }

    sendSuccess(
      res,
      {
        grant: {
          id: String(grant._id),
          status: grant.status,
          reason: grant.reason ?? null,
          requestedAt: grant.requestedAt.toISOString(),
          decidedAt: grant.decidedAt?.toISOString() ?? null,
          decidedByName: grant.decidedByName ?? null,
          expiresAt: grant.expiresAt?.toISOString() ?? null,
          usable: isGrantUsable(grant),
          uses: grant.uses.length,
        },
      },
      "Access request retrieved"
    );
  } catch (err) {
    sendError(res, "Failed to read the access request", 500, (err as Error).message);
  }
};

/**
 * POST /admin/firms/:id/access-session
 *
 * Mints the read-only firm session an approved grant permits. The session is
 * read-only in its own claims and refused for any unsafe method by
 * authenticateFirm, so this cannot be used to change a firm's data.
 *
 * Every mint is written to the grant and to the admin audit log, because "who
 * looked inside this firm, and when" is the question a firm will eventually
 * ask.
 */
export const startAccessSession = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const loaded = await loadFirm(req, res);
    if (!loaded) return;
    const { firm } = loaded;

    const grant = await FirmAccessGrant.findOne({
      firmId: firm._id,
      adminId: req.admin?.adminId,
      status: "approved",
    }).sort({ createdAt: -1 });

    if (!isGrantUsable(grant)) {
      sendError(
        res,
        "No live approval for this firm. Ask the managing partner, and wait for them to approve it.",
        403
      );
      return;
    }

    const owner = await FirmMember.findOne({ firmId: firm._id, role: "managing_partner" })
      .select("_id email role")
      .lean();
    if (!owner) {
      sendError(res, "This firm has no managing partner to act as", 409);
      return;
    }

    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
      req.ip ??
      undefined;

    await FirmAccessGrant.updateOne(
      { _id: grant!._id },
      { $push: { uses: { at: new Date(), ip } } }
    );

    await recordAdminAction({
      admin: req.admin,
      action: "Opened a read-only support session",
      firmId: firm._id as Types.ObjectId,
      firmName: firm.name,
      detail: { grantId: String(grant!._id), expiresAt: grant!.expiresAt },
    });

    // The session is capped by the grant, so it can never outlive the
    // permission that produced it.
    const secondsLeft = Math.max(60, Math.floor((grant!.expiresAt!.getTime() - Date.now()) / 1000));

    const token = jwt.sign(
      {
        memberId: String(owner._id),
        firmId: String(firm._id),
        email: owner.email,
        role: owner.role,
        scope: "firm",
        readOnly: true,
        grantId: String(grant!._id),
      },
      env.JWT_SECRET,
      { expiresIn: secondsLeft }
    );

    sendSuccess(
      res,
      {
        token,
        readOnly: true,
        expiresAt: grant!.expiresAt?.toISOString(),
        firm: { id: String(firm._id), name: firm.name },
      },
      "Read-only session opened. It ends when the approval does."
    );
  } catch (err) {
    sendError(res, "Failed to open the session", 500, (err as Error).message);
  }
};

/** GET /admin/firms/:id/notes */
export const listNotes = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    if (!Types.ObjectId.isValid(id)) {
      sendNotFound(res, "Firm not found");
      return;
    }
    const notes = await FirmNote.find({ firmId: id }).sort({ createdAt: -1 }).lean();
    sendSuccess(
      res,
      notes.map((note) => ({
        id: note._id.toString(),
        author: note.authorName,
        body: note.body,
        at: note.createdAt,
      })),
      "Notes retrieved"
    );
  } catch (err) {
    sendError(res, "Failed to retrieve notes", 500, (err as Error).message);
  }
};

/** POST /admin/firms/:id/notes */
export const addNote = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const loaded = await loadFirm(req, res);
    if (!loaded) return;
    const { firm } = loaded;

    const body = String((req.body as { body?: string }).body ?? "").trim();
    if (!body) {
      sendError(res, "Write the note first", 400);
      return;
    }
    if (body.length > 4000) {
      sendError(res, "That note is too long", 400, "4000 characters at most");
      return;
    }

    const note = await FirmNote.create({
      firmId: firm._id,
      adminId: req.admin?.adminId,
      authorName: await adminNameFor(req.admin),
      body,
    });

    // A note is something an admin did to a firm's record, so it belongs on the
    // audit trail too — the note's own text stays in the note, not the log.
    await recordAdminAction({
      admin: req.admin,
      action: "Added an admin note",
      firmId: firm._id as Types.ObjectId,
      firmName: firm.name,
      detail: { noteId: note._id.toString(), length: body.length },
    });

    sendSuccess(
      res,
      { id: note._id.toString(), author: note.authorName, body: note.body, at: note.createdAt },
      "Note saved",
      201
    );
  } catch (err) {
    sendError(res, "Failed to save the note", 500, (err as Error).message);
  }
};

/** PATCH /admin/firms/tickets/:ticketId — mark a support ticket resolved. */
export const resolveTicket = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.ticketId);
    if (!Types.ObjectId.isValid(id)) {
      sendNotFound(res, "Ticket not found");
      return;
    }
    const ticket = await SupportTicket.findById(id);
    if (!ticket) {
      sendNotFound(res, "Ticket not found");
      return;
    }
    if (ticket.status === "resolved") {
      sendSuccess(res, { status: "resolved" }, "Already resolved");
      return;
    }

    ticket.status = "resolved";
    ticket.resolvedAt = new Date();
    ticket.resolvedByAdminId = req.admin?.adminId as unknown as Types.ObjectId;
    await ticket.save();

    const firm = await Firm.findById(ticket.firmId).select("name").lean();
    await recordAdminAction({
      admin: req.admin,
      action: `Resolved ${ticket.reference}: ${ticket.subject}`,
      firmId: ticket.firmId,
      firmName: firm?.name,
    });

    sendSuccess(
      res,
      { reference: ticket.reference, status: ticket.status, resolvedAt: ticket.resolvedAt },
      "Ticket resolved"
    );
  } catch (err) {
    sendError(res, "Failed to resolve the ticket", 500, (err as Error).message);
  }
};

export type { FirmPlan };
