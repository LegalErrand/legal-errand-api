import { Request, Response } from "express";
import { Types } from "mongoose";
import {
  Client,
  Firm,
  FirmMember,
  FirmTimeEntry,
  Matter,
  CalendarEvent,
  PortalShare,
  PortalRequest,
  PortalMessage,
  PortalBooking,
  FirmDocument,
  IMatter,
  MatterStage,
} from "../../models/firm";
import { PortalAuthRequest, PortalTokenPayload } from "../../types/portal";
import { signPortalToken, PORTAL_TOKEN_TTL_SECONDS } from "../../middleware/portalAuth.middleware";
import { deepseekService } from "../../services/ai/deepseek.service";
import { env } from "../../config/env";
import { firmIdOf } from "../../utils/tenancy";
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendForbidden,
} from "../../utils/response";

/* ─────────────────────────── Response shapes ────────────────────────────── */
/* These mirror legalerrand-firm-app/src/lib/api/portal.ts field for field. */

type PortalInvoiceStatus = "outstanding" | "paid" | "overdue";

interface PortalMatterDto {
  id: string;
  name: string;
  stage: string;
  progressPercent: number;
  startedOn?: string;
  nextDate?: string;
  nextDateLabel?: string;
  lawyerName?: string;
  lawyerInitials?: string;
}

interface PortalTimelineStepDto {
  id: string;
  label: string;
  date?: string;
  state: "done" | "now" | "next" | "later";
  youShouldAttend?: boolean;
}

interface PortalRequestDto {
  id: string;
  label: string;
  askedOn?: string;
  dueOn?: string;
  outstanding: boolean;
}

interface PortalDocumentDto {
  id: string;
  name: string;
  sharedOn?: string;
  read?: boolean;
  needsSignature?: boolean;
  direction: "from_firm" | "from_client";
  receivedOn?: string;
}

interface PortalInvoiceDto {
  id: string;
  reference: string;
  amountNaira: number;
  status: PortalInvoiceStatus;
  issuedOn?: string;
  dueOn?: string;
  receiptUrl?: string;
}

interface PortalMessageDto {
  id: string;
  from: "client" | "firm";
  authorName?: string;
  body: string;
  sentAt: string;
}

interface PortalEventDto {
  id: string;
  title: string;
  startsAt: string;
  endsAt?: string;
  timeZone: string;
  kind: "hearing" | "meeting" | "firm_task";
  youShouldAttend?: boolean;
  whatToBring?: string;
  arriveBy?: string;
  location?: string;
}

interface PortalOverviewDto {
  firmName: string;
  firmLogoUrl?: string;
  brandColor?: string;
  clientFirstName: string;
  matter: PortalMatterDto;
  timeline: PortalTimelineStepDto[];
  requests: PortalRequestDto[];
  chargingBasis?: string;
  outstandingNaira: number;
  paidToDateNaira: number;
  preferredChannel?: string;
  email?: string;
  phone?: string;
}

interface BookingSlotDto {
  id: string;
  startsAt: string;
  timeZone: string;
}

/* ───────────────────────────── Tenancy helpers ──────────────────────────── */

/**
 * The only source of `clientId` / `firmId` for every portal query.
 *
 * Reading them from `req.portal` — the verified token — and never from a param,
 * query string or body is what stops a client asking for someone else's file.
 * A request parameter is attacker-controlled; these claims are signed.
 */
function portalScopeOf(req: Request): PortalTokenPayload {
  const claims = (req as PortalAuthRequest).portal;
  if (!claims) {
    throw new Error("No portal claims on the request — portalAuth is not mounted on this route");
  }
  return claims;
}

/** `{ firmId, clientId }` — the mandatory filter on every client-owned collection. */
function portalFilter(claims: PortalTokenPayload): { firmId: string; clientId: string } {
  return { firmId: claims.firmId, clientId: claims.clientId };
}

const DEFAULT_TIME_ZONE = "Africa/Lagos";

/**
 * The matters this client is allowed to see: theirs, in this firm, and narrowed
 * to one matter when the link was minted for one.
 *
 * Everything matter-derived (calendar, invoices, document context) is keyed off
 * these ids, so there is no path by which another client's matter can appear.
 */
async function permittedMatters(claims: PortalTokenPayload): Promise<IMatter[]> {
  const filter: Record<string, unknown> = portalFilter(claims);
  if (claims.matterId) filter._id = claims.matterId;
  return Matter.find(filter).sort({ updatedAt: -1 });
}

const STAGE_ORDER: MatterStage[] = ["Intake", "Filing", "Discovery", "Hearing", "Review", "Closed"];

/** Internal event types never reach a client. */
const CLIENT_VISIBLE_EVENT_TYPES = ["court", "filing", "meeting"] as const;

function eventKindOf(type: string): PortalEventDto["kind"] {
  if (type === "court") return "hearing";
  if (type === "meeting") return "meeting";
  return "firm_task";
}

/** `YYYY-MM-DD` + optional `HH:mm` → an ISO instant the front end can format. */
function toIso(date: string, time?: string): string {
  const parsed = new Date(`${date}T${(time ?? "09:00").slice(0, 5)}:00`);
  return Number.isNaN(parsed.getTime())
    ? new Date(`${date}T09:00:00`).toISOString()
    : parsed.toISOString();
}

/* ───────────────────────────── GET /portal/overview ─────────────────────── */

export const getPortalOverview = async (req: Request, res: Response): Promise<void> => {
  try {
    const claims = portalScopeOf(req);
    const scope = portalFilter(claims);

    const [firm, client, matters, requests] = await Promise.all([
      Firm.findById(claims.firmId).select("name jurisdiction").lean(),
      Client.findOne({ _id: claims.clientId, firmId: claims.firmId }).lean(),
      permittedMatters(claims),
      PortalRequest.find(scope).sort({ outstanding: -1, askedOn: -1 }).lean(),
    ]);

    if (!client) {
      sendNotFound(res, "This portal link is no longer valid");
      return;
    }

    const matter = matters[0];
    const matterIds = matters.map((m) => m._id as Types.ObjectId);

    // Only this client's own matters' events, and only client-visible types.
    const nextEvent = matterIds.length
      ? await CalendarEvent.findOne({
          firmId: claims.firmId,
          matterId: { $in: matterIds },
          type: { $in: CLIENT_VISIBLE_EVENT_TYPES },
          date: { $gte: new Date().toISOString().slice(0, 10) },
        })
          .sort({ date: 1 })
          .lean()
      : null;

    // Fees are derived only from approved, billable time on this client's own
    // matters — never from the firm's own subscription invoices.
    const entries = matterIds.length
      ? await FirmTimeEntry.find({
          firmId: claims.firmId,
          matterId: { $in: matterIds },
          billable: true,
          approved: true,
        }).lean()
      : [];

    const billedNaira = entries.reduce((sum, e) => sum + e.duration * (e.rate ?? 50000), 0);
    const hourlyRate = entries[0]?.rate ?? 50000;

    const stageIndex = matter ? STAGE_ORDER.indexOf(matter.stage) : -1;
    const timeline: PortalTimelineStepDto[] = matter
      ? STAGE_ORDER.map((stage, index) => ({
          id: `stage-${stage.toLowerCase()}`,
          label: stage,
          date:
            stage === "Hearing" && nextEvent?.type === "court"
              ? nextEvent.date
              : index === stageIndex
                ? matter.nextDeadline
                : undefined,
          state:
            index < stageIndex
              ? "done"
              : index === stageIndex
                ? "now"
                : index === stageIndex + 1
                  ? "next"
                  : "later",
          ...(stage === "Hearing" ? { youShouldAttend: true } : {}),
        }))
      : [];

    const payload: PortalOverviewDto = {
      firmName: firm?.name ?? "Your firm",
      clientFirstName: client.name.trim().split(/\s+/)[0] ?? client.name,
      matter: {
        id: matter ? String(matter._id) : "",
        name: matter?.name ?? "Your matter",
        stage: matter?.stage ?? "Intake",
        progressPercent: matter?.stageProgress ?? 0,
        startedOn: client.clientSince ?? matter?.createdAt?.toISOString().slice(0, 10),
        nextDate: nextEvent?.date ?? matter?.nextDeadline,
        nextDateLabel: nextEvent?.title,
        lawyerName: matter?.lawyerName ?? client.lawyerName,
        lawyerInitials: (matter?.lawyerName ?? client.lawyerName ?? "")
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase() ?? "")
          .join(""),
      },
      timeline,
      requests: requests.map((r) => ({
        id: String(r._id),
        label: r.label,
        askedOn: r.askedOn?.toISOString(),
        dueOn: r.dueOn?.toISOString(),
        outstanding: r.outstanding,
      })),
      chargingBasis: `₦${hourlyRate.toLocaleString("en-NG")}/h, as set out in your engagement letter`,
      outstandingNaira: billedNaira,
      paidToDateNaira: 0,
      preferredChannel: client.preferredChannel,
      email: client.email,
      phone: client.phone,
    };

    sendSuccess(res, payload, "Portal overview retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to load your portal", error);
  }
};

/* ───────────────────────────── GET /portal/documents ────────────────────── */

/**
 * Shared documents only.
 *
 * The query runs against `PortalShare`, never `FirmDocument`. A document is
 * reachable because the firm created a share row for this client — there is no
 * code path that lists the firm's documents and filters afterwards, so a draft
 * or an internal paper cannot leak through a mistake in that filtering.
 */
export const getPortalDocuments = async (req: Request, res: Response): Promise<void> => {
  try {
    const claims = portalScopeOf(req);
    const filter: Record<string, unknown> = portalFilter(claims);
    if (claims.matterId) filter.matterId = claims.matterId;

    const shares = await PortalShare.find(filter).sort({ sharedAt: -1 }).lean();

    const payload: PortalDocumentDto[] = shares.map((share) => ({
      id: String(share.documentId),
      name: share.name,
      sharedOn: share.sharedAt?.toISOString(),
      read: Boolean(share.readAt),
      needsSignature: share.needsSignature,
      direction: share.direction,
      receivedOn: share.receivedAt?.toISOString(),
    }));

    sendSuccess(res, payload, "Shared documents retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to load your documents", error);
  }
};

/* ───────────────────────────── GET /portal/invoices ─────────────────────── */

/**
 * The client's own fees, one invoice per matter of theirs.
 *
 * Built from approved, billable time on their matters. The `Invoice` model is
 * the firm's own subscription billing and is deliberately never read here.
 */
export const getPortalInvoices = async (req: Request, res: Response): Promise<void> => {
  try {
    const claims = portalScopeOf(req);
    const matters = await permittedMatters(claims);

    const payload: PortalInvoiceDto[] = [];

    for (const matter of matters) {
      const entries = await FirmTimeEntry.find({
        firmId: claims.firmId,
        matterId: matter._id,
        billable: true,
        approved: true,
      }).lean();

      if (!entries.length) continue;

      const amountNaira = entries.reduce((sum, e) => sum + e.duration * (e.rate ?? 50000), 0);
      const issuedAt = entries.reduce<Date>(
        (latest, e) => (e.createdAt > latest ? e.createdAt : latest),
        entries[0].createdAt
      );
      const dueOn = new Date(issuedAt.getTime() + 14 * 86400000);

      payload.push({
        id: String(matter._id),
        reference: `INV-${String(matter._id).slice(-6).toUpperCase()}`,
        amountNaira,
        status: dueOn.getTime() < Date.now() ? "overdue" : "outstanding",
        issuedOn: issuedAt.toISOString(),
        dueOn: dueOn.toISOString(),
      });
    }

    sendSuccess(res, payload, "Invoices retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to load your invoices", error);
  }
};

/* ───────────────────────────── Messages ─────────────────────────────────── */

function toMessageDto(message: {
  _id: unknown;
  from: "client" | "firm";
  authorName?: string;
  body: string;
  sentAt: Date;
}): PortalMessageDto {
  return {
    id: String(message._id),
    from: message.from,
    authorName: message.authorName,
    body: message.body,
    sentAt: message.sentAt.toISOString(),
  };
}

/**
 * The client↔firm thread.
 *
 * `PortalMessage` only — `FirmMessage` carries AI suggested replies and
 * confidence scores, which must never reach a client, so it is never queried.
 */
export const getPortalMessages = async (req: Request, res: Response): Promise<void> => {
  try {
    const claims = portalScopeOf(req);
    const messages = await PortalMessage.find(portalFilter(claims)).sort({ sentAt: 1 }).lean();
    sendSuccess(res, messages.map(toMessageDto), "Messages retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to load your messages", error);
  }
};

export const sendPortalMessage = async (req: Request, res: Response): Promise<void> => {
  try {
    const claims = portalScopeOf(req);
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";

    if (!body) {
      sendBadRequest(res, "Please type a message before sending");
      return;
    }

    const client = await Client.findOne({ _id: claims.clientId, firmId: claims.firmId })
      .select("name")
      .lean();

    const created = await PortalMessage.create({
      ...portalFilter(claims),
      ...(claims.matterId ? { matterId: claims.matterId } : {}),
      from: "client",
      authorName: client?.name,
      body,
      sentAt: new Date(),
      raisedWithPartner: false,
    });

    sendCreated(res, toMessageDto(created), "Message sent to your case team");
  } catch (error) {
    sendBadRequest(res, "Failed to send your message", error);
  }
};

/**
 * LE-035 — "Raise it with the partner".
 *
 * Flagged so it reaches the responsible partner rather than the client's own
 * lawyer. The partner is resolved server-side from the firm's own members; the
 * client never names a recipient.
 */
export const raiseWithPartner = async (req: Request, res: Response): Promise<void> => {
  try {
    const claims = portalScopeOf(req);
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";

    if (!body) {
      sendBadRequest(res, "Please describe what has gone wrong");
      return;
    }

    const [client, partner] = await Promise.all([
      Client.findOne({ _id: claims.clientId, firmId: claims.firmId }).select("name").lean(),
      FirmMember.findOne({
        firmId: claims.firmId,
        role: { $in: ["managing_partner", "partner"] },
        isActive: true,
      })
        .select("name")
        .lean(),
    ]);

    await PortalMessage.create({
      ...portalFilter(claims),
      ...(claims.matterId ? { matterId: claims.matterId } : {}),
      from: "client",
      authorName: client?.name,
      body: partner
        ? `[For ${partner.name}, responsible partner] ${body}`
        : `[For the responsible partner] ${body}`,
      sentAt: new Date(),
      raisedWithPartner: true,
    });

    sendCreated(
      res,
      {},
      "Raised with the responsible partner — you will hear back within two hours"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to raise this with the partner", error);
  }
};

/* ───────────────────────────── GET /portal/calendar ─────────────────────── */

/**
 * Only this client's own dates.
 *
 * Filtered by firm *and* by the ids of their own matters, and restricted to
 * client-visible event types so internal work and AI-generated entries never
 * appear.
 */
export const getPortalCalendar = async (req: Request, res: Response): Promise<void> => {
  try {
    const claims = portalScopeOf(req);
    const month = typeof req.query.month === "string" ? req.query.month : "";

    if (!/^\d{4}-\d{2}$/.test(month)) {
      sendBadRequest(res, "A month in the form YYYY-MM is required");
      return;
    }

    const matters = await permittedMatters(claims);
    const matterIds = matters.map((m) => m._id as Types.ObjectId);

    if (!matterIds.length) {
      sendSuccess(res, [], "No dates for this month");
      return;
    }

    const events = await CalendarEvent.find({
      firmId: claims.firmId,
      matterId: { $in: matterIds },
      type: { $in: CLIENT_VISIBLE_EVENT_TYPES },
      date: { $regex: `^${month}` },
    })
      .sort({ date: 1 })
      .lean();

    const payload: PortalEventDto[] = events.map((event) => {
      const kind = eventKindOf(event.type);
      return {
        id: String(event._id),
        title: event.title,
        startsAt: toIso(event.date, event.time),
        timeZone: DEFAULT_TIME_ZONE,
        kind,
        ...(kind === "hearing"
          ? {
              youShouldAttend: true,
              whatToBring: "Your ID and any original documents we have asked you for",
              arriveBy: "30 minutes before the listed time",
            }
          : {}),
        location: event.location,
      };
    });

    sendSuccess(res, payload, "Your dates retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to load your calendar", error);
  }
};

/* ───────────────────────────── Booking ──────────────────────────────────── */

const SLOT_HOURS = [10, 12, 14, 16];
const SLOT_DAYS_AHEAD = 10;

/**
 * Candidate slots, derived rather than stored, so a slot id carries no
 * information about the firm's diary beyond the time offered.
 */
function candidateSlots(): BookingSlotDto[] {
  const slots: BookingSlotDto[] = [];
  const now = Date.now();

  for (let day = 1; day <= SLOT_DAYS_AHEAD; day += 1) {
    const date = new Date(now + day * 86400000);
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;

    for (const hour of SLOT_HOURS) {
      const startsAt = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, 0, 0)
      );
      slots.push({
        id: `slot-${startsAt.toISOString()}`,
        startsAt: startsAt.toISOString(),
        timeZone: DEFAULT_TIME_ZONE,
      });
    }
  }

  return slots;
}

export const getBookingSlots = async (req: Request, res: Response): Promise<void> => {
  try {
    const claims = portalScopeOf(req);

    // Only times already taken in this firm are withheld; the client is told
    // nothing about who holds them.
    const taken = await PortalBooking.find({
      firmId: claims.firmId,
      status: "booked",
      startsAt: { $gte: new Date() },
    })
      .select("startsAt")
      .lean();

    const takenKeys = new Set(taken.map((b) => b.startsAt.toISOString()));
    sendSuccess(
      res,
      candidateSlots().filter((slot) => !takenKeys.has(slot.startsAt)),
      "Available slots retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to load available slots", error);
  }
};

export const createBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const claims = portalScopeOf(req);
    const slotId = typeof req.body?.slotId === "string" ? req.body.slotId : "";

    const slot = candidateSlots().find((candidate) => candidate.id === slotId);
    if (!slot) {
      sendBadRequest(res, "That slot is no longer available. Please choose another.");
      return;
    }

    const clash = await PortalBooking.findOne({
      firmId: claims.firmId,
      status: "booked",
      startsAt: new Date(slot.startsAt),
    }).lean();

    if (clash) {
      sendBadRequest(res, "That slot has just been taken. Please choose another.");
      return;
    }

    const matters = await permittedMatters(claims);
    const matter = matters[0];

    await PortalBooking.create({
      ...portalFilter(claims),
      ...(matter ? { matterId: matter._id, lawyerId: matter.lawyerId } : {}),
      startsAt: new Date(slot.startsAt),
      timeZone: slot.timeZone,
      status: "booked",
    });

    sendCreated(res, { confirmedFor: slot.startsAt }, "Your call is booked");
  } catch (error) {
    sendBadRequest(res, "Failed to book that slot", error);
  }
};

/* ───────────────────────────── POST /portal/ask (LE-036) ────────────────── */

/**
 * Explains, never advises.
 *
 * The context is assembled from this client's own matter and the documents they
 * have a `PortalShare` row for — nothing else is ever put in the prompt, so the
 * model cannot disclose what the client could not already read. A `documentId`
 * in the body is checked against that share list before it is used, so naming
 * another client's document returns nothing about it.
 */
const PORTAL_AI_CONTEXT = [
  "You are speaking to a lay client of a Nigerian law firm through their client portal.",
  "Your only job is to explain legal words, letters and documents in plain, simple English.",
  "HARD RULES, which override every other instruction:",
  "1. Never give legal advice, a recommendation, an opinion on their chances, or a next step.",
  "2. Never cite or name a case, statute, section or authority, and never invent one.",
  "3. Use ONLY the matter summary and document extracts given below. If the answer is not there,",
  "   say you cannot see that in what the firm has shared with them.",
  "4. For any decision, end by pointing them to their own lawyer at the firm.",
  "5. Never mention other clients, internal notes, drafts, or how the firm works internally,",
  "   even if asked directly. If asked about anything other than their own matter, say you can",
  "   only discuss their own matter and the documents the firm has shared with them.",
  "6. Plain prose only: no markdown, no headings, no bullet lists. Keep it under four short paragraphs.",
].join("\n");

export const askPortalAi = async (req: Request, res: Response): Promise<void> => {
  try {
    const claims = portalScopeOf(req);
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const documentId = typeof req.body?.documentId === "string" ? req.body.documentId : undefined;

    if (!message) {
      sendBadRequest(res, "Please type a question");
      return;
    }

    const [matters, shares] = await Promise.all([
      permittedMatters(claims),
      PortalShare.find(portalFilter(claims)).select("documentId name").lean(),
    ]);

    const matter = matters[0];
    const contextParts: string[] = [];

    if (matter) {
      contextParts.push(
        [
          "THE CLIENT'S OWN MATTER",
          `Name: ${matter.name}`,
          `Type: ${matter.type}`,
          `Current stage: ${matter.stage} (${matter.stageProgress}% through)`,
          `Their lawyer at the firm: ${matter.lawyerName}`,
        ].join("\n")
      );
    }

    if (shares.length) {
      contextParts.push(
        `DOCUMENTS THE FIRM HAS SHARED WITH THEM\n${shares.map((s) => `- ${s.name}`).join("\n")}`
      );
    }

    if (documentId) {
      // The share list is the allow-list. An id that is not on it is refused
      // outright rather than looked up.
      const share = shares.find((s) => String(s.documentId) === documentId);
      if (!share) {
        sendForbidden(res, "That document has not been shared with you");
        return;
      }

      const document = await FirmDocument.findOne({ _id: share.documentId, firmId: claims.firmId })
        .select("name content")
        .lean();

      if (document?.content) {
        contextParts.push(
          `EXTRACT OF "${share.name}" (the only document text you may use)\n${document.content.slice(0, 6000)}`
        );
      }
    }

    if (!contextParts.length) {
      sendSuccess(
        res,
        {
          reply:
            "I cannot see anything the firm has shared with you yet, so there is nothing for me to explain. Please send your lawyer a message and they will help.",
        },
        "Answered"
      );
      return;
    }

    const reply = await deepseekService.chat(
      message,
      `${PORTAL_AI_CONTEXT}\n\n${contextParts.join("\n\n")}`,
      1200
    );

    sendSuccess(
      res,
      {
        reply:
          reply.trim() ||
          "I could not put that into plain English just now. Please ask your lawyer and they will explain.",
      },
      "Answered"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to answer that just now", error);
  }
};

/* ───────────────────────────── GET /portal/glossary ─────────────────────── */

/** The 50 common-word chips on the Ask AI tab (LE-036). Static, firm-agnostic. */
const GLOSSARY: ReadonlyArray<{ term: string; plainEnglish: string }> = [
  { term: "Affidavit", plainEnglish: "A written statement you swear is true." },
  { term: "Adjournment", plainEnglish: "The court moving your hearing to a later date." },
  { term: "Appeal", plainEnglish: "Asking a higher court to look at a decision again." },
  { term: "Arbitration", plainEnglish: "Settling a dispute privately instead of in court." },
  { term: "Bail", plainEnglish: "Being released while a criminal case continues." },
  { term: "Bailiff", plainEnglish: "A court officer who delivers court papers." },
  { term: "Breach", plainEnglish: "Breaking a term of an agreement." },
  { term: "Brief", plainEnglish: "The written argument a lawyer files for you." },
  { term: "Caveat", plainEnglish: "A formal warning entered on a record." },
  { term: "Claimant", plainEnglish: "The person who started the case." },
  { term: "Consideration", plainEnglish: "What each side gives up in a contract." },
  { term: "Costs", plainEnglish: "The money a court may order one side to pay the other." },
  { term: "Counterclaim", plainEnglish: "A claim the other side brings back against you." },
  { term: "Damages", plainEnglish: "Money paid to make up for a loss." },
  { term: "Defendant", plainEnglish: "The person the case is brought against." },
  { term: "Deed", plainEnglish: "A formal signed document, often about property." },
  { term: "Deposition", plainEnglish: "Answers given under oath before the hearing." },
  { term: "Discovery", plainEnglish: "The stage where both sides exchange documents." },
  { term: "Easement", plainEnglish: "A right to use part of someone else's land." },
  {
    term: "Engagement letter",
    plainEnglish: "The letter setting out what the firm will do and what it costs.",
  },
  { term: "Estate", plainEnglish: "Everything a person owned when they died." },
  { term: "Ex parte", plainEnglish: "An application made with only one side present." },
  { term: "Executor", plainEnglish: "The person who carries out a will." },
  { term: "Garnishee", plainEnglish: "A court order taking money owed to you to pay a debt." },
  { term: "Hearing", plainEnglish: "The day the court listens to the case." },
  { term: "Indemnity", plainEnglish: "A promise to cover someone else's loss." },
  { term: "Injunction", plainEnglish: "A court order stopping or requiring an action." },
  { term: "Interlocutory", plainEnglish: "A decision made part-way through a case." },
  { term: "Judgment", plainEnglish: "The court's final decision." },
  { term: "Jurisdiction", plainEnglish: "Whether a court has power to hear your case." },
  { term: "Lease", plainEnglish: "An agreement to rent property for a set time." },
  {
    term: "Letters of administration",
    plainEnglish: "Court permission to deal with an estate with no will.",
  },
  { term: "Liability", plainEnglish: "Being legally responsible for something." },
  { term: "Lien", plainEnglish: "A right to keep property until a debt is paid." },
  { term: "Mediation", plainEnglish: "A neutral person helping both sides agree." },
  { term: "Motion", plainEnglish: "A formal request asking the court to do something." },
  { term: "Negligence", plainEnglish: "Failing to take reasonable care, causing harm." },
  { term: "Notice", plainEnglish: "A formal document telling someone something officially." },
  { term: "Party", plainEnglish: "Anyone named on either side of a case." },
  { term: "Pleadings", plainEnglish: "The documents setting out each side's case." },
  { term: "Power of attorney", plainEnglish: "Authority for someone to act for you." },
  { term: "Probate", plainEnglish: "The court process of proving a will." },
  { term: "Retainer", plainEnglish: "Money paid up front for legal work." },
  { term: "Service", plainEnglish: "Officially delivering court papers to the other side." },
  { term: "Settlement", plainEnglish: "Ending a dispute by agreement instead of judgment." },
  { term: "Statute of limitation", plainEnglish: "The deadline for starting a case." },
  { term: "Subpoena", plainEnglish: "An order to attend court or produce a document." },
  { term: "Suit number", plainEnglish: "The reference the court gives your case." },
  { term: "Title", plainEnglish: "Proof that you legally own property." },
  {
    term: "Without prejudice",
    plainEnglish: "Said while trying to settle, so it cannot be used in court.",
  },
  { term: "Witness statement", plainEnglish: "What a witness says happened, in writing." },
];

export const getGlossary = async (_req: Request, res: Response): Promise<void> => {
  sendSuccess(res, GLOSSARY, "Glossary retrieved");
};

/* ──────────────── POST /clients/:id/portal-link (firm-authenticated) ────── */

/**
 * Mints the client's portal link (LE-035).
 *
 * The client is looked up by `{ _id: id, firmId }` where `firmId` comes from
 * the caller's own firm token, so a firm cannot mint a link into another
 * firm's client: an id from elsewhere simply does not match.
 */
export const createClientPortalLink = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const id = String(req.params.id ?? "");

    if (!Types.ObjectId.isValid(id)) {
      sendBadRequest(res, "A valid client id is required");
      return;
    }

    const client = await Client.findOne({ _id: id, firmId }).select("status").lean();
    if (!client) {
      sendNotFound(res, "Client not found");
      return;
    }

    if (client.status === "archived") {
      sendForbidden(res, "This client is archived — restore them before issuing a portal link");
      return;
    }

    const token = signPortalToken({ clientId: String(client._id), firmId });
    const expiresAt = new Date(Date.now() + PORTAL_TOKEN_TTL_SECONDS * 1000).toISOString();

    sendCreated(
      res,
      { link: `${env.FIRM_APP_URL}/portal?token=${token}`, expiresAt },
      "Portal link created"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to create a portal link", error);
  }
};
