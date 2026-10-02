import { Request, Response } from "express";
import { Types } from "mongoose";
import {
  EvidenceItem,
  EvidenceRequest,
  EvidenceCategory,
  EvidenceStatus,
  RequestChannel,
  REQUEST_CHANNELS,
  EVIDENCE_CATEGORIES,
  Matter,
  Client,
  FirmDocument,
  FirmActivityLog,
} from "../../models/firm";
import { sendSuccess, sendCreated, sendBadRequest, sendNotFound } from "../../utils/response";
import { firmIdOf, memberIdOf, roleOf } from "../../utils/tenancy";

/**
 * LE-032 — Evidence and document requests.
 *
 * Evidence is what comes *in* on a matter. It never mixes with work product
 * (FirmDocument), and moving an item across the line is a recorded act: see
 * `moveEvidence`, which refuses without a reason and always writes an audit row.
 *
 * Every query below filters on the firm taken from the verified token. The
 * firm is never read from the body or the query string.
 */

// ─── Shapes the front end reads (src/lib/api/evidence.ts) ────────────────────

interface EvidenceItemDTO {
  id: string;
  name: string;
  originLine?: string;
  origin: string;
  status: EvidenceStatus;
  matterId?: string;
  matterName?: string;
  category?: EvidenceCategory;
  riskScore?: number;
  aiTagged?: boolean;
  received: string;
  scanned?: boolean;
}

interface OutstandingItemDTO {
  id: string;
  requestId: string;
  label: string;
  clientId: string;
  clientName: string;
  matterId?: string;
  matterName?: string;
  channel: RequestChannel;
  askedAt: string;
  dueDate?: string;
  status: "pending" | "received";
  chaseCount?: number;
}

interface SortProposalDTO {
  id: string;
  fileName: string;
  suggestedName?: string;
  suggestedDate?: string;
  suggestedMatterId?: string;
  suggestedMatterName?: string;
  suggestedCategory?: EvidenceCategory;
  confidence?: number;
}

type EvidenceTab = "all" | "received_at_intake" | "asked_and_received" | "unsorted" | "other_side";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** "Asked 3 days ago" / "Asked today" — the human line the card renders. */
function humanAgo(when: Date, prefix = ""): string {
  const days = Math.floor((Date.now() - when.getTime()) / 86_400_000);
  if (days <= 0) return `${prefix}today`.trim();
  if (days === 1) return `${prefix}yesterday`.trim();
  return `${prefix}${days} days ago`.trim();
}

function receivedLabel(when: Date): string {
  return when.toISOString().slice(0, 10);
}

/** Roles that may not message clients — their requests become suggestions. */
const CANNOT_MESSAGE_CLIENTS = new Set(["junior_associate", "paralegal", "intern"]);

function toItemDTO(doc: {
  _id: Types.ObjectId;
  name: string;
  origin?: string;
  cameFrom: string;
  status: EvidenceStatus;
  matterId?: Types.ObjectId;
  matterName?: string;
  category?: EvidenceCategory;
  riskScore?: number;
  aiTagged: boolean;
  scanned: boolean;
  uploadedAt: Date;
}): EvidenceItemDTO {
  return {
    id: String(doc._id),
    name: doc.name,
    originLine: doc.origin,
    origin: doc.cameFrom,
    status: doc.status,
    matterId: doc.matterId ? String(doc.matterId) : undefined,
    matterName: doc.matterName,
    category: doc.category,
    riskScore: doc.riskScore,
    aiTagged: doc.aiTagged,
    received: receivedLabel(doc.uploadedAt),
    scanned: doc.scanned,
  };
}

/**
 * The matters the caller may open. Juniors, paralegals and interns see evidence
 * only on matters assigned to them; everyone else sees the firm's.
 *
 * Returns `null` when the caller is unrestricted, so the caller can skip the
 * extra `matterId` clause rather than loading every matter id.
 */
async function visibleMatterIds(req: Request): Promise<Types.ObjectId[] | null> {
  const role = roleOf(req);
  if (!CANNOT_MESSAGE_CLIENTS.has(role)) return null;

  const matters = await Matter.find({ firmId: firmIdOf(req), lawyerId: memberIdOf(req) })
    .select("_id")
    .lean();
  return matters.map((m) => m._id as Types.ObjectId);
}

// ─── GET /evidence ───────────────────────────────────────────────────────────

export const getEvidence = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const tab = (req.query.tab as EvidenceTab | undefined) ?? "all";
    const { matterId, status } = req.query;

    // firmId is set first and is never overwritten by a query parameter.
    const filter: Record<string, unknown> = { firmId };

    const allowed = await visibleMatterIds(req);
    if (allowed) filter.matterId = { $in: allowed };

    if (matterId && matterId !== "all") {
      filter.matterId = matterId === "unattached" ? { $exists: false } : matterId;
    }
    if (status && status !== "all") filter.status = status;

    switch (tab) {
      case "received_at_intake":
        filter.cameFrom = "intake";
        break;
      case "asked_and_received":
        filter.cameFrom = "requested";
        break;
      case "other_side":
        filter.cameFrom = "other_side";
        break;
      case "unsorted":
        filter.status = "not_indexed";
        break;
      default:
        break;
    }

    const docs = await EvidenceItem.find(filter).sort({ uploadedAt: -1 });
    const items = docs.map(toItemDTO);

    // Counts describe this firm, so they carry the same scope as the list.
    const scopedBase: Record<string, unknown> = { firmId };
    if (allowed) scopedBase.matterId = { $in: allowed };

    const byMatter = await EvidenceItem.aggregate<{ _id: Types.ObjectId | null; n: number }>([
      { $match: scopedBase },
      { $group: { _id: "$matterId", n: { $sum: 1 } } },
    ]);
    const matterCounts: Record<string, number> = {};
    for (const row of byMatter) {
      matterCounts[row._id ? String(row._id) : "unattached"] = row.n;
    }

    const notIndexedCount = await EvidenceItem.countDocuments({
      ...scopedBase,
      status: "not_indexed",
    });

    const requestFilter: Record<string, unknown> = { firmId, status: { $ne: "complete" } };
    if (allowed) requestFilter.matterId = { $in: allowed };
    const requests = await EvidenceRequest.find(requestFilter).sort({ createdAt: -1 });

    const outstanding: OutstandingItemDTO[] = [];
    for (const r of requests) {
      for (const line of r.items) {
        if (line.received) continue;
        outstanding.push({
          id: String(line._id),
          requestId: String(r._id),
          label: line.label,
          clientId: String(r.clientId),
          clientName: r.clientName ?? "",
          matterId: r.matterId ? String(r.matterId) : undefined,
          matterName: r.matterName,
          channel: r.channel,
          askedAt: humanAgo(r.sentAt ?? r.createdAt, "Asked "),
          dueDate: r.neededBy,
          status: "pending",
          chaseCount: line.chaseCount,
        });
      }
    }

    sendSuccess(res, { items, outstanding, matterCounts, notIndexedCount }, "Evidence retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve evidence", error);
  }
};

// ─── GET /evidence/requests/checklist ────────────────────────────────────────

/** LE-032's general list, used when no matter narrows the request. */
const GENERAL_CHECKLIST = [
  "Signed engagement letter",
  "Proof of identity (NIN, passport or licence)",
  "Proof of address",
  "CAC documents",
  "Title documents",
  "Bank statements",
  "Correspondence with the other side",
  "Court papers already served",
  "Death certificate",
  "Will or codicil",
];

/** Suggested documents per practice area, keyed on a lowercased substring. */
const CHECKLIST_BY_AREA: { match: string; items: string[] }[] = [
  {
    match: "litigation",
    items: [
      "Court papers already served",
      "Correspondence with the other side",
      "Witness statements",
      "Proof of identity (NIN, passport or licence)",
    ],
  },
  {
    match: "corporate",
    items: ["CAC documents", "Board resolutions", "Shareholders agreement", "Bank statements"],
  },
  {
    match: "property",
    items: ["Title documents", "Survey plan", "Deed of assignment", "Proof of payment"],
  },
  {
    match: "probate",
    items: ["Death certificate", "Will or codicil", "Proof of identity of beneficiaries"],
  },
  {
    match: "family",
    items: ["Marriage certificate", "Proof of address", "Bank statements"],
  },
  {
    match: "employment",
    items: ["Employment contract", "Payslips", "Termination letter"],
  },
];

const SUGGESTED_QUESTIONS = [
  "When did this first happen?",
  "Who else was involved?",
  "What has the other side said so far?",
  "Is there a deadline we should know about?",
  "What outcome would you be happy with?",
];

export const getRequestChecklist = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const { clientId, matterId } = req.query;

    let practiceArea = "";
    let matterDeadline: string | undefined;

    if (matterId) {
      // Scoped lookup: findById alone would read another firm's matter.
      const matter = await Matter.findOne({ _id: String(matterId), firmId });
      if (!matter) {
        sendNotFound(res, "Matter not found");
        return;
      }
      practiceArea = matter.type;
      matterDeadline = matter.nextDeadline;
    } else if (clientId) {
      const client = await Client.findOne({ _id: String(clientId), firmId });
      if (!client) {
        sendNotFound(res, "Client not found");
        return;
      }
      practiceArea = client.practiceArea;
    }

    const area = practiceArea.toLowerCase();
    const matched = CHECKLIST_BY_AREA.find((entry) => area.includes(entry.match));
    const items = matched ? matched.items : GENERAL_CHECKLIST;

    // Nobody is asked twice: anything already in from intake is listed apart.
    const receivedFilter: Record<string, unknown> = { firmId, cameFrom: "intake" };
    if (matterId) receivedFilter.matterId = matterId;
    const received = await EvidenceItem.find(receivedFilter).select("name").lean();
    const alreadyReceived = received.map((d) => d.name);

    const lowerReceived = new Set(alreadyReceived.map((n) => n.toLowerCase()));

    sendSuccess(
      res,
      {
        items: items.filter((i) => !lowerReceived.has(i.toLowerCase())),
        questions: SUGGESTED_QUESTIONS,
        alreadyReceived,
        matterDeadline,
      },
      "Checklist retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to build the checklist", error);
  }
};

// ─── POST /evidence/requests ─────────────────────────────────────────────────

export const createRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const memberId = memberIdOf(req);
    const { clientId, matterId, channel, items, questions, neededBy, message, asSuggestion } =
      req.body as {
        clientId?: string;
        matterId?: string;
        channel?: RequestChannel;
        items?: string[];
        questions?: string[];
        neededBy?: string;
        message?: string;
        asSuggestion?: boolean;
      };

    if (!clientId) {
      sendBadRequest(res, "A client is required");
      return;
    }

    const docItems = Array.isArray(items) ? items.filter((i) => i.trim()) : [];
    const docQuestions = Array.isArray(questions) ? questions.filter((q) => q.trim()) : [];

    // A request with only questions is valid; a request with neither is not.
    if (docItems.length === 0 && docQuestions.length === 0) {
      sendBadRequest(res, "Ask for at least one document or question");
      return;
    }

    const client = await Client.findOne({ _id: clientId, firmId });
    if (!client) {
      sendNotFound(res, "Client not found");
      return;
    }

    let matterName: string | undefined;
    if (matterId) {
      const matter = await Matter.findOne({ _id: matterId, firmId });
      if (!matter) {
        sendNotFound(res, "Matter not found");
        return;
      }
      matterName = matter.name;
    }

    // Staff who cannot message clients only ever raise a draft, whatever the
    // body says — the flag is a floor, not a switch the client can turn off.
    const queueAsSuggestion = asSuggestion === true || CANNOT_MESSAGE_CLIENTS.has(roleOf(req));

    const resolvedChannel: RequestChannel =
      channel && REQUEST_CHANNELS.includes(channel)
        ? channel
        : client.preferredChannel === "whatsapp"
          ? "WhatsApp"
          : "Email";

    const created = await EvidenceRequest.create({
      firmId,
      clientId,
      clientName: client.name,
      matterId,
      matterName,
      channel: resolvedChannel,
      items: docItems.map((label) => ({ label, received: false, chaseCount: 0 })),
      questions: docQuestions,
      neededBy,
      message: message ?? "",
      // Everything goes through approval first; a suggestion stays a draft for
      // the supervisor to send.
      status: queueAsSuggestion ? "draft" : "awaiting_approval",
      asSuggestion: queueAsSuggestion,
      requestedBy: memberId,
    });

    sendCreated(
      res,
      { id: String(created._id), queuedForApproval: !queueAsSuggestion },
      queueAsSuggestion ? "Request drafted for approval" : "Request queued for approval"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to create the request", error);
  }
};

// ─── POST /evidence/requests/:id/items/:itemId/received ──────────────────────

export const markItemReceived = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const { id, itemId } = req.params;

    const request = await EvidenceRequest.findOne({ _id: id, firmId });
    if (!request) {
      sendNotFound(res, "Request not found");
      return;
    }

    const line = request.items.id(String(itemId));
    if (!line) {
      sendNotFound(res, "Requested item not found");
      return;
    }

    line.received = true;
    line.receivedAt = new Date();

    // The request closes itself once nothing is outstanding.
    if (request.items.every((i) => i.received)) request.status = "complete";
    await request.save();

    // What came back lands on the matter, tagged with where it came from. It is
    // unscanned until the virus scan clears, so nothing can open it yet.
    const item = await EvidenceItem.create({
      firmId,
      matterId: request.matterId,
      matterName: request.matterName,
      name: line.label,
      origin: "Client upload · requested",
      cameFrom: "requested",
      status: request.matterId ? "in_review" : "not_indexed",
      scanned: false,
      aiTagged: false,
    });

    sendSuccess(
      res,
      { item: toItemDTO(item), requestStatus: request.status },
      "Item marked received"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to mark the item received", error);
  }
};

// ─── POST /evidence/requests/:id/items/:itemId/remind ────────────────────────

export const remindItem = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const { id, itemId } = req.params;

    const request = await EvidenceRequest.findOne({ _id: id, firmId });
    if (!request) {
      sendNotFound(res, "Request not found");
      return;
    }

    const line = request.items.id(String(itemId));
    if (!line) {
      sendNotFound(res, "Requested item not found");
      return;
    }
    if (line.received) {
      sendBadRequest(res, "That item is already in — there is nothing to chase");
      return;
    }

    line.chaseCount += 1;
    line.lastChasedAt = new Date();
    await request.save();

    // The AI chases twice before escalating; the third chase is a person's job.
    sendSuccess(
      res,
      {
        itemId: String(line._id),
        chaseCount: line.chaseCount,
        channel: request.channel,
        escalate: line.chaseCount > 2,
      },
      "Reminder sent"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to send the reminder", error);
  }
};

// ─── POST /evidence/attach ───────────────────────────────────────────────────

export const attachEvidence = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const { files } = req.body as { files?: { name?: string; matterId?: string }[] };

    if (!Array.isArray(files) || files.length === 0) {
      sendBadRequest(res, "At least one file is required");
      return;
    }

    // Evidence cannot sit outside a matter.
    if (files.some((f) => !f.name || !f.matterId)) {
      sendBadRequest(res, "Every file needs a name and a matter");
      return;
    }

    const matterIds = [...new Set(files.map((f) => String(f.matterId)))];
    const matters = await Matter.find({ _id: { $in: matterIds }, firmId })
      .select("name")
      .lean();
    const nameById = new Map(matters.map((m) => [String(m._id), m.name]));

    // A matter that is not this firm's simply is not found, so the attach fails
    // rather than filing evidence into a stranger's matter.
    if (nameById.size !== matterIds.length) {
      sendNotFound(res, "One of those matters was not found");
      return;
    }

    const created = await Promise.all(
      files.map((f) =>
        EvidenceItem.create({
          firmId,
          matterId: f.matterId,
          matterName: nameById.get(String(f.matterId)),
          name: f.name,
          origin: "Client upload",
          cameFrom: "client_upload",
          status: "not_indexed",
          scanned: false,
          aiTagged: false,
        })
      )
    );

    sendCreated(res, created.map(toItemDTO), "Evidence attached");
  } catch (error) {
    sendBadRequest(res, "Failed to attach the evidence", error);
  }
};

// ─── POST /evidence/sort ─────────────────────────────────────────────────────

/**
 * Filename keywords → category. A deterministic heuristic is used here rather
 * than the AI service: the proposal has to be reproducible for the reviewer who
 * accepts or changes it, and nothing moves until they do.
 */
const CATEGORY_HINTS: { category: EvidenceCategory; words: string[] }[] = [
  {
    category: "court_papers",
    words: [
      "motion",
      "affidavit",
      "writ",
      "summons",
      "claim",
      "order",
      "judgment",
      "suit",
      "pleading",
      "defence",
    ],
  },
  {
    category: "correspondence",
    words: ["letter", "email", "mail", "memo", "notice", "demand", "reply", "correspondence"],
  },
  {
    category: "witness",
    words: ["witness", "statement", "deposition", "testimony", "declaration"],
  },
  {
    category: "exhibits",
    words: [
      "exhibit",
      "receipt",
      "invoice",
      "photo",
      "image",
      "contract",
      "agreement",
      "deed",
      "certificate",
      "statement_of_account",
    ],
  },
];

/** `YYYY-MM-DD` or `DD-MM-YYYY` read off the filename, when one is there. */
function dateFromFileName(fileName: string): string | undefined {
  const iso = fileName.match(/(20\d{2})[-_.](\d{2})[-_.](\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = fileName.match(/(\d{2})[-_.](\d{2})[-_.](20\d{2})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return undefined;
}

function titleCase(raw: string): string {
  const cleaned = raw
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return raw;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export const startSorting = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const { itemIds } = req.body as { itemIds?: string[] };

    const filter: Record<string, unknown> = { firmId, status: "not_indexed" };
    if (Array.isArray(itemIds) && itemIds.length > 0) {
      // Scoped by firmId as well, so an id from another firm matches nothing.
      filter._id = { $in: itemIds };
      delete filter.status;
    }

    const items = await EvidenceItem.find(filter).sort({ uploadedAt: -1 });
    const matters = await Matter.find({ firmId }).select("name suitNumber clientName").lean();

    const proposals: SortProposalDTO[] = items.map((item) => {
      const lower = item.name.toLowerCase();

      const hint = CATEGORY_HINTS.find((h) => h.words.some((w) => lower.includes(w)));

      // A matter already on the item stands; otherwise look for a matter whose
      // name, suit number or client appears in the filename.
      let suggestedMatterId = item.matterId ? String(item.matterId) : undefined;
      let suggestedMatterName = item.matterName;
      let matched = Boolean(suggestedMatterId);

      if (!matched) {
        const byName = matters.find((m) => {
          const needles = [m.name, m.suitNumber, m.clientName].filter(
            (n): n is string => Boolean(n) && String(n).length > 3
          );
          return needles.some((n) => lower.includes(n.toLowerCase()));
        });
        if (byName) {
          suggestedMatterId = String(byName._id);
          suggestedMatterName = byName.name;
          matched = true;
        }
      }

      // Confidence is honest about how much the filename actually gave us.
      const confidence =
        (matched ? 55 : 20) + (hint ? 25 : 0) + (dateFromFileName(item.name) ? 15 : 0);

      return {
        id: String(item._id),
        fileName: item.name,
        suggestedName: titleCase(item.name),
        suggestedDate: dateFromFileName(item.name),
        suggestedMatterId,
        suggestedMatterName,
        suggestedCategory: hint?.category,
        confidence: Math.min(confidence, 95),
      };
    });

    sendSuccess(res, proposals, "Sort proposals ready");
  } catch (error) {
    sendBadRequest(res, "Failed to propose a sort", error);
  }
};

// ─── POST /evidence/sort/apply ───────────────────────────────────────────────

export const applySorting = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const { assignments } = req.body as {
      assignments?: {
        id?: string;
        name?: string;
        matterId?: string;
        category?: EvidenceCategory;
        date?: string;
      }[];
    };

    if (!Array.isArray(assignments) || assignments.length === 0) {
      sendBadRequest(res, "At least one assignment is required");
      return;
    }

    if (assignments.some((a) => !a.id || !a.matterId)) {
      sendBadRequest(res, "Every assignment needs an item and a matter");
      return;
    }

    const matterIds = [...new Set(assignments.map((a) => String(a.matterId)))];
    const matters = await Matter.find({ _id: { $in: matterIds }, firmId })
      .select("name")
      .lean();
    const nameById = new Map(matters.map((m) => [String(m._id), m.name]));
    if (nameById.size !== matterIds.length) {
      sendNotFound(res, "One of those matters was not found");
      return;
    }

    let filed = 0;
    for (const a of assignments) {
      if (a.category && !EVIDENCE_CATEGORIES.includes(a.category)) {
        sendBadRequest(res, `Unknown category: ${a.category}`);
        return;
      }

      // Scoped lookup — an id from another firm matches nothing here.
      const item = await EvidenceItem.findOne({ _id: a.id, firmId });
      if (!item) continue;

      if (a.name) item.name = a.name;
      item.matterId = new Types.ObjectId(String(a.matterId));
      item.matterName = nameById.get(String(a.matterId));
      if (a.category) item.category = a.category;
      item.status = "filed";
      item.aiTagged = true;
      if (a.date) item.uploadedAt = new Date(a.date);
      await item.save();
      filed += 1;
    }

    sendSuccess(res, { filed }, "Evidence filed");
  } catch (error) {
    sendBadRequest(res, "Failed to apply the sort", error);
  }
};

// ─── POST /evidence/move ─────────────────────────────────────────────────────

/**
 * Moving evidence is a recorded act.
 *
 * Evidence and work product never mix, so crossing that line — or moving an
 * item onto a different matter — is refused without a reason and always leaves
 * an audit row behind. The reason check runs before anything is read or
 * written, so a reasonless request cannot move a single item.
 */
export const moveEvidence = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const memberId = memberIdOf(req);
    const { itemIds, destination, matterId, reason } = req.body as {
      itemIds?: string[];
      destination?: "matter" | "documents";
      matterId?: string;
      reason?: string;
    };

    // The reason is the record. No reason, no move — checked first.
    if (typeof reason !== "string" || reason.trim().length === 0) {
      sendBadRequest(res, "A reason is required to move evidence — the move is recorded");
      return;
    }
    const trimmedReason = reason.trim();

    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      sendBadRequest(res, "At least one item is required");
      return;
    }
    if (destination !== "matter" && destination !== "documents") {
      sendBadRequest(res, "Destination must be 'matter' or 'documents'");
      return;
    }
    if (destination === "matter" && !matterId) {
      sendBadRequest(res, "A matter is required when moving to a matter");
      return;
    }

    let destMatterName: string | undefined;
    if (destination === "matter") {
      const matter = await Matter.findOne({ _id: matterId, firmId });
      if (!matter) {
        sendNotFound(res, "Matter not found");
        return;
      }
      destMatterName = matter.name;
    }

    const items = await EvidenceItem.find({ _id: { $in: itemIds }, firmId });
    if (items.length === 0) {
      sendNotFound(res, "No matching evidence found");
      return;
    }

    let moved = 0;
    for (const item of items) {
      if (destination === "matter") {
        item.matterId = new Types.ObjectId(String(matterId));
        item.matterName = destMatterName;
        item.status = "filed";
        await item.save();
      } else {
        // Across to Documents: the item leaves Evidence entirely, because the
        // two never hold the same row.
        await FirmDocument.create({
          firmId,
          name: item.name,
          type: "Filed document",
          matterId: item.matterId,
          matterName: item.matterName,
          status: "filed",
          source: "filed",
          aiTags: [],
        });
        await item.deleteOne();
      }
      moved += 1;
    }

    // Metadata only: the audit row names the destination and the reason, never
    // the client or the contents.
    await FirmActivityLog.create({
      firmId,
      memberId,
      type: "document",
      summary:
        destination === "documents"
          ? `Moved ${moved} evidence item(s) across to Documents — ${trimmedReason}`
          : `Moved ${moved} evidence item(s) to another matter — ${trimmedReason}`,
      reference: destination === "matter" ? String(matterId) : undefined,
      at: new Date(),
    });

    sendSuccess(res, { moved }, "Evidence moved");
  } catch (error) {
    sendBadRequest(res, "Failed to move the evidence", error);
  }
};
