import { Request, Response } from "express";
import crypto from "crypto";
import {
  Firm,
  FirmAccessGrant,
  FirmMember,
  ACCESS_GRANT_TTL_MS,
  isGrantUsable,
} from "../../models/firm";
import {
  sendSuccess,
  sendBadRequest,
  sendNotFound,
  sendForbidden,
  sendServerError,
} from "../../utils/response";
import { firmIdOf, memberIdOf, roleOf } from "../../utils/tenancy";
import { FirmAuthRequest } from "../../types/firm";

/**
 * The firm's side of an admin access request (LE-011 / support).
 *
 * The owner holds no admin account and should not have to log in to answer, so
 * the decision is reachable from a one-time link in their email. The link is
 * the credential; it is matched on a hash and stops working once used.
 */

const sha256 = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");

/** Roles that may answer or revoke. The owner is asked, partners may act. */
const DECIDER_ROLES = ["managing_partner", "partner"];

/** Loads a pending grant from a link token, or null. */
async function grantFromToken(token: string) {
  if (!token) return null;
  return FirmAccessGrant.findOne({
    decisionTokenHash: sha256(token),
    status: "pending",
    decisionExpiresAt: { $gt: new Date() },
  });
}

/**
 * GET /firm/access-request/:token — what is being asked, before answering.
 *
 * Public: reachable from the email with no session. It returns only what the
 * email already said, so the link discloses nothing new if it is forwarded.
 */
export const getAccessRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const grant = await grantFromToken(String(req.params.token ?? ""));
    if (!grant) {
      sendNotFound(res, "This request has been answered already, or the link has expired");
      return;
    }

    const firm = await Firm.findById(grant.firmId).select("name");

    sendSuccess(
      res,
      {
        firmName: firm?.name ?? "your firm",
        adminEmail: grant.adminEmail,
        reason: grant.reason ?? null,
        requestedAt: grant.requestedAt.toISOString(),
        hours: ACCESS_GRANT_TTL_MS / 3_600_000,
      },
      "Access request retrieved"
    );
  } catch (error) {
    sendServerError(res, "Could not open that request", error);
  }
};

/**
 * POST /firm/access-request/:token/approve
 *
 * Starts the clock. The claim is atomic, so two clicks cannot produce two
 * windows, and the second is told the first already answered.
 */
export const approveAccessRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = String(req.params.token ?? "");
    const grant = await grantFromToken(token);
    if (!grant) {
      sendNotFound(res, "This request has been answered already, or the link has expired");
      return;
    }

    const { name } = req.body as { name?: string };
    const expiresAt = new Date(Date.now() + ACCESS_GRANT_TTL_MS);

    const claimed = await FirmAccessGrant.findOneAndUpdate(
      { _id: grant._id, status: "pending" },
      {
        $set: {
          status: "approved",
          decidedAt: new Date(),
          decidedByName: String(name ?? "").trim() || "The managing partner",
          expiresAt,
        },
      },
      { new: true }
    );

    if (!claimed) {
      sendBadRequest(res, "That request has already been answered");
      return;
    }

    const firm = await Firm.findById(claimed.firmId).select("name");

    sendSuccess(
      res,
      {
        status: "approved",
        firmName: firm?.name ?? "your firm",
        expiresAt: expiresAt.toISOString(),
        hours: ACCESS_GRANT_TTL_MS / 3_600_000,
      },
      "Approved. It ends automatically, and you can end it sooner from Settings."
    );
  } catch (error) {
    sendServerError(res, "Could not approve that request", error);
  }
};

/** POST /firm/access-request/:token/decline — the normal answer, no reason needed. */
export const declineAccessRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const grant = await grantFromToken(String(req.params.token ?? ""));
    if (!grant) {
      sendNotFound(res, "This request has been answered already, or the link has expired");
      return;
    }

    const claimed = await FirmAccessGrant.findOneAndUpdate(
      { _id: grant._id, status: "pending" },
      { $set: { status: "declined", decidedAt: new Date() } },
      { new: true }
    );

    if (!claimed) {
      sendBadRequest(res, "That request has already been answered");
      return;
    }

    sendSuccess(res, { status: "declined" }, "Declined. Nobody has been given access.");
  } catch (error) {
    sendServerError(res, "Could not decline that request", error);
  }
};

/**
 * GET /firm/access-grants — who has, or has asked for, access to this firm.
 *
 * Authenticated and firm-scoped, so a firm can see its own history without a
 * link. This is the screen a partner checks when they want to know who has
 * been inside.
 */
export const listAccessGrants = async (req: FirmAuthRequest, res: Response): Promise<void> => {
  try {
    const rows = await FirmAccessGrant.find({ firmId: firmIdOf(req) })
      .sort({ createdAt: -1 })
      .limit(50);

    sendSuccess(
      res,
      {
        grants: rows.map((g) => ({
          id: String(g._id),
          adminEmail: g.adminEmail,
          reason: g.reason ?? null,
          status: g.status,
          requestedAt: g.requestedAt.toISOString(),
          decidedAt: g.decidedAt?.toISOString() ?? null,
          decidedByName: g.decidedByName ?? null,
          expiresAt: g.expiresAt?.toISOString() ?? null,
          revokedAt: g.revokedAt?.toISOString() ?? null,
          live: isGrantUsable(g),
          /** How many read-only sessions were opened against it. */
          uses: g.uses.length,
          lastUsedAt: g.uses.length ? g.uses[g.uses.length - 1].at.toISOString() : null,
        })),
      },
      "Access grants retrieved"
    );
  } catch (error) {
    sendServerError(res, "Could not list the access grants", error);
  }
};

/**
 * POST /firm/access-grants/:id/revoke — end it now.
 *
 * Revoking kills the sessions already minted, not just future ones:
 * authenticateFirm re-checks the grant on every request a read-only session
 * makes, so the next one fails.
 */
export const revokeAccessGrant = async (req: FirmAuthRequest, res: Response): Promise<void> => {
  try {
    if (!DECIDER_ROLES.includes(roleOf(req))) {
      sendForbidden(res, "Only a partner can end a support session");
      return;
    }

    const member = await FirmMember.findById(memberIdOf(req)).select("name").lean();

    const revoked = await FirmAccessGrant.findOneAndUpdate(
      {
        _id: req.params.id,
        firmId: firmIdOf(req),
        status: "approved",
        revokedAt: { $exists: false },
      },
      {
        $set: {
          status: "revoked",
          revokedAt: new Date(),
          decidedByName: member?.name ?? "A partner",
        },
      },
      { new: true }
    );

    if (!revoked) {
      sendNotFound(res, "That access is not live");
      return;
    }

    sendSuccess(res, { id: String(revoked._id) }, "Access ended. Any open session stops at once.");
  } catch (error) {
    sendServerError(res, "Could not end that access", error);
  }
};
