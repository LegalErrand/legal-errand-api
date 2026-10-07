import { Request, Response } from "express";
import { Types } from "mongoose";
import {
  OfficeRegisterEntry,
  OFFICE_REGISTER_KINDS,
  OFFICE_REGISTER_STATUSES,
  IOfficeRegisterEntry,
  IOfficeRegisterStamp,
  OfficeRegisterKind,
  OfficeRegisterStatus,
  FirmOfficeAccount,
  FirmMember,
  CalendarEvent,
  ClientInvoice,
  Matter,
} from "../../models/firm";
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendForbidden,
} from "../../utils/response";
import { firmIdOf, memberIdOf, roleOf } from "../../utils/tenancy";
import { deepseekService } from "../../services/ai/deepseek.service";
import { ConversationMessage } from "../../types";

/**
 * LE-011 — Firm admin (office manager) dashboard.
 *
 * ── Privilege, enforced here and not only in the UI ──────────────────────────
 * The header of that screen reads: "Matter content is not yours to read — you
 * see that a matter exists and what it bills, never what it says." That is a
 * control, so it lives on the server:
 *
 *  • Nothing in this file touches FirmDocument, DocumentVersion,
 *    DocumentComment, FirmNote, FirmMessage, EvidenceItem, ReviewQueueItem or
 *    AIApprovalAction. There is no endpoint here that could return them.
 *  • `Matter` is only ever counted (`countDocuments`). No matter document is
 *    returned, because the model carries `aiSummary`, `urgentItems` and
 *    `recentActivity`, all of which are matter content.
 *  • `CalendarEvent` is read through a positive allow-list of logistics fields
 *    (date, time, type, matter name, lawyer, location) — never `title`,
 *    `relatedTasks` or `documents`, which describe the work rather than the
 *    office arrangements for it.
 *  • `ClientInvoice` is read for money only, with lines (which describe the
 *    work done) projected out.
 *
 * ── Tenancy ─────────────────────────────────────────────────────────────────
 * Every query filters by `firmIdOf(req)`. There is no `findById` anywhere, and
 * `firmId` is never read from a request body.
 */

// ─── Role gate ───────────────────────────────────────────────────────────────

/**
 * Hiding a tab is not a control, so every handler calls this first. Admin only:
 * LE-003's matrix gives "Manage roles and settings" to the managing partner and
 * the admin, but this dashboard is the office manager's own screen and the
 * partners have their own (LE-009), so there is no reason to widen it.
 */
function assertAdmin(req: Request, res: Response): boolean {
  if (roleOf(req) !== "admin") {
    sendForbidden(res, "The firm administration dashboard is for the office manager only");
    return false;
  }
  return true;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** The caller, named, for the "who and when" stamp on every register write. */
async function stampFor(req: Request): Promise<IOfficeRegisterStamp> {
  const firmId = firmIdOf(req);
  const memberId = memberIdOf(req);
  const member = await FirmMember.findOne({ _id: memberId, firmId }).select("name").lean();
  return {
    memberId: new Types.ObjectId(memberId),
    name: member?.name ?? "Office manager",
    at: new Date(),
  };
}

function isRegisterKind(value: unknown): value is OfficeRegisterKind {
  return typeof value === "string" && (OFFICE_REGISTER_KINDS as readonly string[]).includes(value);
}

function isRegisterStatus(value: unknown): value is OfficeRegisterStatus {
  return (
    typeof value === "string" && (OFFICE_REGISTER_STATUSES as readonly string[]).includes(value)
  );
}

const startOfToday = (): Date => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const addDays = (from: Date, days: number): Date => new Date(from.getTime() + days * 86_400_000);

/**
 * The calendar date a human in this timezone would call it.
 *
 * Not toISOString().slice(0, 10): that is the UTC date, and the office runs on
 * WAT. At local midnight the two disagree, so a row filed "today" would be
 * filtered out as yesterday's.
 */
const localISODate = (value: Date | string): string => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

/** Whole days from today to `date`, negative when it has already passed. */
function daysUntil(date?: Date | null): number | null {
  if (!date) return null;
  return Math.round((new Date(date).getTime() - startOfToday().getTime()) / 86_400_000);
}

/**
 * LE-005's ladder: an alert fires 30, 14 and 3 days ahead, and keeps firing
 * once the date has passed.
 */
export type AlertTier = "overdue" | "3_days" | "14_days" | "30_days" | null;

function alertTier(date?: Date | null): AlertTier {
  const days = daysUntil(date);
  if (days === null) return null;
  if (days < 0) return "overdue";
  if (days <= 3) return "3_days";
  if (days <= 14) return "14_days";
  if (days <= 30) return "30_days";
  return null;
}

/** The shape every register row is returned in, alert tier included. */
function presentEntry(entry: IOfficeRegisterEntry) {
  return {
    id: String(entry._id),
    kind: entry.kind,
    title: entry.title,
    detail: entry.detail,
    status: entry.status,
    personName: entry.personName,
    coverName: entry.coverName,
    vendorName: entry.vendorName,
    amountNaira: entry.amountNaira,
    quantityUsed: entry.quantityUsed,
    quantityTotal: entry.quantityTotal,
    progressPct: entry.progressPct,
    startOn: entry.startOn,
    endOn: entry.endOn,
    dueOn: entry.dueOn,
    location: entry.location,
    reference: entry.reference,
    reason: entry.reason,
    matterName: entry.matterName,
    alertTier: alertTier(entry.dueOn),
    daysUntilDue: daysUntil(entry.dueOn),
    createdBy: entry.createdBy,
    updatedBy: entry.updatedBy,
    completedBy: entry.completedBy,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

export type PresentedEntry = ReturnType<typeof presentEntry>;

async function entriesOfKind(
  firmId: string,
  kinds: OfficeRegisterKind[]
): Promise<PresentedEntry[]> {
  const rows = await OfficeRegisterEntry.find({ firmId, kind: { $in: kinds } }).sort({
    dueOn: 1,
    createdAt: -1,
  });
  return rows.map(presentEntry);
}

/**
 * Court diary logistics. The allow-list is the whole point: the office needs to
 * know who is going where with what, and nothing about what the matter says.
 */
async function courtDiary(firmId: string, fromISO: string, toISO: string) {
  const events = await CalendarEvent.find({
    firmId,
    type: { $in: ["court", "filing"] },
    date: { $gte: fromISO, $lte: toISO },
  })
    // Positive allow-list. `title`, `relatedTasks` and `documents` are matter
    // content and are deliberately absent.
    .select("date time type matter lawyer location")
    .sort({ date: 1, time: 1 })
    .lean();

  return events.map((e) => ({
    id: String(e._id),
    date: e.date,
    time: e.time ?? null,
    type: e.type,
    matterName: e.matter ?? null,
    lawyer: e.lawyer ?? null,
    location: e.location ?? null,
  }));
}

// ─── Overview ────────────────────────────────────────────────────────────────

export const getOverview = async (req: Request, res: Response): Promise<void> => {
  if (!assertAdmin(req, res)) return;
  try {
    const firmId = firmIdOf(req);
    const todayISO = new Date().toISOString().slice(0, 10);

    const [diary, frontDesk, headcount, openMatters] = await Promise.all([
      courtDiary(firmId, todayISO, todayISO),
      entriesOfKind(firmId, ["message", "visitor", "registry_run", "room_booking", "attendance"]),
      FirmMember.countDocuments({ firmId, isActive: true }),
      // Counted, never read. See the privilege note at the top of this file.
      Matter.countDocuments({ firmId }),
    ]);

    const open = (kind: OfficeRegisterKind) =>
      frontDesk.filter((e) => e.kind === kind && e.status !== "done");

    const counters = {
      onTheDiaryToday: diary.length,
      messagesToPassOn: open("message").length,
      visitorsExpected: open("visitor").length,
      goingOutToday: open("registry_run").length,
      headcount,
      openMatters,
    };

    // "Today, in order". Diary items come from the calendar, office items from
    // the registers, and both are sorted by clock time so the timeline reads as
    // one day rather than two lists. Now/Done is computed from the clock.
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    const toMinutes = (time?: string | null): number | null => {
      if (!time) return null;
      const m = /^(\d{1,2}):(\d{2})/.exec(time);
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };

    const timeline = [
      ...diary.map((d) => ({
        id: d.id,
        time: d.time,
        label: d.type === "filing" ? "Filing" : "Hearing",
        detail: [d.matterName, d.lawyer, d.location].filter(Boolean).join(" · "),
        source: "diary" as const,
        done: false,
      })),
      ...frontDesk
        .filter((e) => e.kind !== "attendance")
        .map((e) => ({
          id: e.id,
          time: e.startOn ? new Date(e.startOn).toISOString().slice(11, 16) : null,
          label: e.title,
          detail: [e.personName, e.location, e.detail].filter(Boolean).join(" · "),
          source: "office" as const,
          done: e.status === "done",
        })),
    ].sort((a, b) => (toMinutes(a.time) ?? 1_440) - (toMinutes(b.time) ?? 1_440));

    // The first item that is not done and whose time has arrived is "Now".
    const nowIndex = timeline.findIndex(
      (t) => !t.done && (toMinutes(t.time) === null || (toMinutes(t.time) as number) >= nowMinutes)
    );
    const withState = timeline.map((t, i) => ({
      ...t,
      state: t.done ? ("done" as const) : i === nowIndex ? ("now" as const) : ("later" as const),
    }));

    sendSuccess(
      res,
      {
        counters,
        timeline: withState,
        diary,
        // Stated by the server so the UI cannot quietly claim the AI sees more
        // than it does.
        aiCannotSee: [
          "anything a matter says — its documents, notes, messages or AI activity",
          "advice given to a client",
          "another firm's data",
        ],
        suggestedQuestions: [
          "Which invoices should I chase first?",
          "Who is away next month?",
          "What is due to FIRS this month?",
          "Draft the courier renewal",
          "What does today look like?",
        ],
      },
      "Overview retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve the overview", error);
  }
};

// ─── Finance ─────────────────────────────────────────────────────────────────

export const getFinance = async (req: Request, res: Response): Promise<void> => {
  if (!assertAdmin(req, res)) return;
  try {
    const firmId = firmIdOf(req);
    const today = startOfToday();

    const [invoices, accounts, registers] = await Promise.all([
      // Money only. `lines` describes the work that was done, so it is
      // projected out — the admin sees what a matter bills, not what it says.
      ClientInvoice.find({ firmId, status: { $ne: "draft" } })
        .select("reference clientName matterName totalNaira paidNaira status issuedOn dueOn")
        .sort({ dueOn: 1 })
        .lean(),
      FirmOfficeAccount.find({ firmId }).sort({ accountType: 1, name: 1 }).lean(),
      entriesOfKind(firmId, ["running_cost", "expense_claim", "petty_cash", "statutory_deadline"]),
    ]);

    // Receivables by age, from the invoices themselves rather than entered.
    const buckets = { current: 0, days1to30: 0, days31to60: 0, days60plus: 0 };
    const toChase: Array<{
      id: string;
      reference: string;
      clientName: string;
      matterName: string | null;
      outstandingNaira: number;
      daysOverdue: number;
      reportToPartners: boolean;
    }> = [];

    for (const inv of invoices) {
      const outstanding = Math.max(0, (inv.totalNaira ?? 0) - (inv.paidNaira ?? 0));
      if (outstanding <= 0) continue;
      const due = inv.dueOn ? new Date(inv.dueOn) : null;
      const overdue = due ? Math.round((today.getTime() - due.getTime()) / 86_400_000) : 0;

      if (overdue <= 0) buckets.current += outstanding;
      else if (overdue <= 30) buckets.days1to30 += outstanding;
      else if (overdue <= 60) buckets.days31to60 += outstanding;
      else buckets.days60plus += outstanding;

      if (overdue > 0) {
        toChase.push({
          id: String(inv._id),
          reference: inv.reference,
          clientName: inv.clientName,
          matterName: inv.matterName ?? null,
          outstandingNaira: outstanding,
          daysOverdue: overdue,
          // LE-011: anything past 60 days is reported to partners weekly.
          reportToPartners: overdue > 60,
        });
      }
    }
    toChase.sort((a, b) => b.daysOverdue - a.daysOverdue);

    const billedNaira = invoices.reduce((sum, i) => sum + (i.totalNaira ?? 0), 0);
    const collectedNaira = invoices.reduce((sum, i) => sum + (i.paidNaira ?? 0), 0);

    // The office account and the client account are reported separately and
    // never summed. Client money is held on trust — it is not the firm's.
    const officeAccounts = accounts.filter((a) => a.accountType === "office");
    const clientAccounts = accounts.filter((a) => a.accountType === "client");
    const sumBalances = (list: typeof accounts) =>
      list.reduce((sum, a) => sum + (a.balanceNaira ?? 0), 0);

    const present = (a: (typeof accounts)[number]) => ({
      id: String(a._id),
      accountType: a.accountType,
      name: a.name,
      bankName: a.bankName ?? null,
      accountNumberLast4: a.accountNumberLast4 ?? null,
      balanceNaira: a.balanceNaira ?? 0,
      asOf: a.asOf,
      heldOnTrust: a.accountType === "client",
      createdByName: a.createdByName,
      updatedByName: a.updatedByName ?? null,
      updatedAt: a.updatedAt,
    });

    const of = (kind: OfficeRegisterKind) => registers.filter((r) => r.kind === kind);
    const pettyCash = of("petty_cash");
    const floatNaira = pettyCash.reduce((sum, p) => sum + (p.amountNaira ?? 0), 0);

    sendSuccess(
      res,
      {
        billing: {
          billedNaira,
          collectedNaira,
          collectedPct: billedNaira > 0 ? Math.round((collectedNaira / billedNaira) * 100) : 0,
          outstandingNaira: Math.max(0, billedNaira - collectedNaira),
        },
        accounts: {
          office: {
            accounts: officeAccounts.map(present),
            totalNaira: sumBalances(officeAccounts),
          },
          client: {
            accounts: clientAccounts.map(present),
            totalNaira: sumBalances(clientAccounts),
            note: "Held on trust — never the firm's. Not available to meet the firm's costs.",
          },
        },
        receivables: { buckets, toChase },
        runningCosts: of("running_cost"),
        expenseClaims: of("expense_claim"),
        pettyCash: {
          entries: pettyCash,
          floatNaira,
          // A float under ₦50,000 is the point at which the office starts
          // turning away small cash errands, so that is where the nudge sits.
          needsTopUp: floatNaira < 50_000,
        },
        statutoryDeadlines: of("statutory_deadline"),
      },
      "Finance retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve finance", error);
  }
};

// ─── Human resources ─────────────────────────────────────────────────────────

export const getHr = async (req: Request, res: Response): Promise<void> => {
  if (!assertAdmin(req, res)) return;
  try {
    const firmId = firmIdOf(req);

    const [members, registers] = await Promise.all([
      // Derived, not entered: headcount is whoever is on FirmMember.
      FirmMember.find({ firmId, isActive: true })
        .select("name role isActive")
        .sort({ name: 1 })
        .lean(),
      entriesOfKind(firmId, ["leave", "certificate", "appraisal", "hiring"]),
    ]);

    const of = (kind: OfficeRegisterKind) => registers.filter((r) => r.kind === kind);
    const leave = of("leave");
    const certificates = of("certificate");

    const byRole: Record<string, number> = {};
    for (const m of members) byRole[m.role] = (byRole[m.role] ?? 0) + 1;

    const soon = addDays(startOfToday(), 30);
    const onLeaveSoon = leave.filter(
      (l) => l.status !== "done" && l.startOn && new Date(l.startOn) <= soon
    );

    sendSuccess(
      res,
      {
        counters: {
          headcount: members.length,
          onLeaveSoon: onLeaveSoon.length,
          certificatesAtRisk: certificates.filter(
            (c) => c.alertTier !== null && c.status !== "done"
          ).length,
          appraisalsDue: of("appraisal").filter((a) => a.status !== "done").length,
        },
        byRole,
        members: members.map((m) => ({ id: String(m._id), name: m.name, role: m.role })),
        // The warning the spec asks for: leave with nobody covering it.
        leave: leave.map((l) => ({ ...l, coverMissing: !l.coverName && l.status !== "done" })),
        certificates,
        appraisals: of("appraisal"),
        hiring: of("hiring"),
        enforcementNote:
          "A lapsed practising certificate or unpaid NBA dues blocks that person from being named on a filing.",
      },
      "HR retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve HR", error);
  }
};

// ─── Operations and facilities ───────────────────────────────────────────────

export const getOperations = async (req: Request, res: Response): Promise<void> => {
  if (!assertAdmin(req, res)) return;
  try {
    const firmId = firmIdOf(req);
    const today = startOfToday();
    const todayISO = today.toISOString().slice(0, 10);

    const [diary, registers] = await Promise.all([
      courtDiary(firmId, todayISO, addDays(today, 14).toISOString().slice(0, 10)),
      entriesOfKind(firmId, ["vendor", "incident", "asset", "room_booking", "statutory_deadline"]),
    ]);

    const of = (kind: OfficeRegisterKind) => registers.filter((r) => r.kind === kind);

    sendSuccess(
      res,
      {
        // Logistics only — see courtDiary's allow-list.
        courtDiary: diary,
        vendors: of("vendor").map((v) => ({
          ...v,
          expired: v.daysUntilDue !== null && v.daysUntilDue < 0,
        })),
        incidents: of("incident"),
        assets: of("asset"),
        roomsToday: of("room_booking").filter(
          (r) => r.startOn && new Date(r.startOn).toISOString().slice(0, 10) === todayISO
        ),
        statutoryDeadlines: of("statutory_deadline"),
      },
      "Operations retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve operations", error);
  }
};

// ─── Front desk ──────────────────────────────────────────────────────────────

/**
 * The reception desk's own day: what came in, who is coming, what is being
 * typed, what is going out, what is running low and who is in the building.
 *
 * Room bookings are deliberately not here. They are the same register the
 * Operations tab already shows as "Rooms today", and one register owned by two
 * tabs is a reconciliation problem rather than a convenience.
 */
export const getFrontDesk = async (req: Request, res: Response): Promise<void> => {
  if (!assertAdmin(req, res)) return;
  try {
    const firmId = firmIdOf(req);
    const todayISO = localISODate(new Date());

    const registers = await entriesOfKind(firmId, [
      "correspondence",
      "message",
      "visitor",
      "typing",
      "registry_run",
      "supply",
      "attendance",
    ]);

    const of = (kind: OfficeRegisterKind) => registers.filter((r) => r.kind === kind);
    const onDay = (value?: Date | string | null) => !!value && localISODate(value) === todayISO;

    sendSuccess(
      res,
      {
        correspondence: of("correspondence"),
        messages: of("message"),
        // Expected today, plus anyone still open from an earlier day so a
        // visitor who never arrived is not quietly dropped off the desk.
        visitors: of("visitor").filter((v) => onDay(v.startOn) || v.status !== "done"),
        typing: of("typing"),
        registryRuns: of("registry_run"),
        supplies: of("supply").map((item) => ({
          ...item,
          // "Low" is a quarter left or less, which is the point at which
          // reordering still arrives before the shelf is empty.
          low:
            item.quantityTotal !== undefined &&
            item.quantityTotal > 0 &&
            item.quantityUsed !== undefined &&
            item.quantityTotal - item.quantityUsed <= item.quantityTotal / 4,
        })),
        whoIsIn: of("attendance").filter((a) => onDay(a.startOn) || !a.startOn),
      },
      "Front desk retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve front desk", error);
  }
};

// ─── Technology and systems ──────────────────────────────────────────────────

export const getTechnology = async (req: Request, res: Response): Promise<void> => {
  if (!assertAdmin(req, res)) return;
  try {
    const firmId = firmIdOf(req);
    const [registers, seatsUsed] = await Promise.all([
      entriesOfKind(firmId, ["system", "licence", "support_ticket", "security_item", "backup"]),
      FirmMember.countDocuments({ firmId, isActive: true }),
    ]);

    const of = (kind: OfficeRegisterKind) => registers.filter((r) => r.kind === kind);

    sendSuccess(
      res,
      {
        systems: of("system"),
        securityPosture: of("security_item"),
        backups: of("backup"),
        // Seats used is the live headcount, not a number anyone types in.
        licences: of("licence").map((l) => ({ ...l, quantityUsed: l.quantityUsed ?? seatsUsed })),
        supportTickets: of("support_ticket"),
      },
      "Technology retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve technology", error);
  }
};

// ─── Strategic planning ──────────────────────────────────────────────────────

export const getStrategy = async (req: Request, res: Response): Promise<void> => {
  if (!assertAdmin(req, res)) return;
  try {
    const firmId = firmIdOf(req);
    const registers = await entriesOfKind(firmId, ["objective", "risk", "decision"]);
    const of = (kind: OfficeRegisterKind) => registers.filter((r) => r.kind === kind);

    const objectives = of("objective");
    const avgProgress = objectives.length
      ? Math.round(objectives.reduce((sum, o) => sum + (o.progressPct ?? 0), 0) / objectives.length)
      : 0;

    sendSuccess(
      res,
      {
        objectives,
        averageProgressPct: avgProgress,
        risks: of("risk"),
        decisions: of("decision"),
      },
      "Strategy retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve strategy", error);
  }
};

// ─── Registers — add, edit, mark done, delete ────────────────────────────────

/**
 * The writable fields, as an allow-list. Building the update this way is what
 * stops a body from setting `firmId`, a stamp, or anything else it should not
 * reach — spreading `req.body` would.
 */
function readWritableFields(body: Record<string, unknown>): Partial<IOfficeRegisterEntry> {
  const out: Partial<IOfficeRegisterEntry> = {};
  const str = (key: keyof IOfficeRegisterEntry) => {
    const v = body[key as string];
    if (typeof v === "string") out[key] = v.trim() as never;
  };
  const num = (key: keyof IOfficeRegisterEntry) => {
    const v = body[key as string];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v as never;
  };
  const date = (key: keyof IOfficeRegisterEntry) => {
    const v = body[key as string];
    if (typeof v === "string" && v) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) out[key] = d as never;
    } else if (v === null) {
      out[key] = undefined as never;
    }
  };

  str("title");
  str("detail");
  str("personName");
  str("coverName");
  str("vendorName");
  str("location");
  str("reference");
  str("reason");
  str("matterName");
  num("amountNaira");
  num("quantityUsed");
  num("quantityTotal");
  num("progressPct");
  date("startOn");
  date("endOn");
  date("dueOn");

  if (isRegisterStatus(body.status)) out.status = body.status;
  return out;
}

export const listRegister = async (req: Request, res: Response): Promise<void> => {
  if (!assertAdmin(req, res)) return;
  try {
    const firmId = firmIdOf(req);
    const { kind } = req.params;
    if (!isRegisterKind(kind)) {
      sendBadRequest(res, `Unknown register "${kind}"`);
      return;
    }
    const rows = await OfficeRegisterEntry.find({ firmId, kind }).sort({ dueOn: 1, createdAt: -1 });
    sendSuccess(res, { entries: rows.map(presentEntry) }, "Register retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve the register", error);
  }
};

export const createRegisterEntry = async (req: Request, res: Response): Promise<void> => {
  if (!assertAdmin(req, res)) return;
  try {
    const firmId = firmIdOf(req);
    const { kind } = req.params;
    if (!isRegisterKind(kind)) {
      sendBadRequest(res, `Unknown register "${kind}"`);
      return;
    }

    const fields = readWritableFields(req.body as Record<string, unknown>);
    if (!fields.title) {
      sendBadRequest(res, "A register entry needs a title");
      return;
    }

    // firmId and kind come from the token and the route, never from the body.
    const entry = await OfficeRegisterEntry.create({
      ...fields,
      firmId,
      kind,
      status: fields.status ?? "open",
      createdBy: await stampFor(req),
    });

    sendCreated(res, presentEntry(entry), "Register entry added");
  } catch (error) {
    sendBadRequest(res, "Failed to add the register entry", error);
  }
};

export const updateRegisterEntry = async (req: Request, res: Response): Promise<void> => {
  if (!assertAdmin(req, res)) return;
  try {
    const firmId = firmIdOf(req);
    const { kind, id } = req.params;
    if (!isRegisterKind(kind)) {
      sendBadRequest(res, `Unknown register "${kind}"`);
      return;
    }

    // Scoped lookup. findById alone would let one firm edit another's register.
    const entry = await OfficeRegisterEntry.findOne({ _id: id, firmId, kind });
    if (!entry) {
      sendNotFound(res, "Register entry not found");
      return;
    }

    const fields = readWritableFields(req.body as Record<string, unknown>);
    Object.assign(entry, fields);
    entry.updatedBy = await stampFor(req);
    await entry.save();

    sendSuccess(res, presentEntry(entry), "Register entry updated");
  } catch (error) {
    sendBadRequest(res, "Failed to update the register entry", error);
  }
};

/** Mark done, or re-open. Either way the stamp records who and when. */
export const completeRegisterEntry = async (req: Request, res: Response): Promise<void> => {
  if (!assertAdmin(req, res)) return;
  try {
    const firmId = firmIdOf(req);
    const { kind, id } = req.params;
    if (!isRegisterKind(kind)) {
      sendBadRequest(res, `Unknown register "${kind}"`);
      return;
    }

    const entry = await OfficeRegisterEntry.findOne({ _id: id, firmId, kind });
    if (!entry) {
      sendNotFound(res, "Register entry not found");
      return;
    }

    const done = (req.body as { done?: boolean }).done !== false;
    const stamp = await stampFor(req);
    entry.status = done ? "done" : "open";
    entry.completedBy = done ? stamp : undefined;
    entry.updatedBy = stamp;
    await entry.save();

    sendSuccess(res, presentEntry(entry), done ? "Marked done" : "Re-opened");
  } catch (error) {
    sendBadRequest(res, "Failed to change the register entry", error);
  }
};

export const deleteRegisterEntry = async (req: Request, res: Response): Promise<void> => {
  if (!assertAdmin(req, res)) return;
  try {
    const firmId = firmIdOf(req);
    const { kind, id } = req.params;
    if (!isRegisterKind(kind)) {
      sendBadRequest(res, `Unknown register "${kind}"`);
      return;
    }

    const deleted = await OfficeRegisterEntry.findOneAndDelete({ _id: id, firmId, kind });
    if (!deleted) {
      sendNotFound(res, "Register entry not found");
      return;
    }
    sendSuccess(res, { id }, "Register entry deleted");
  } catch (error) {
    sendBadRequest(res, "Failed to delete the register entry", error);
  }
};

// ─── Accounts — office and client, kept apart ────────────────────────────────

export const upsertAccount = async (req: Request, res: Response): Promise<void> => {
  if (!assertAdmin(req, res)) return;
  try {
    const firmId = firmIdOf(req);
    const body = req.body as {
      accountType?: string;
      name?: string;
      bankName?: string;
      accountNumberLast4?: string;
      balanceNaira?: number;
      asOf?: string;
    };

    if (body.accountType !== "office" && body.accountType !== "client") {
      sendBadRequest(res, "An account must be either the office account or the client account");
      return;
    }
    if (!body.name) {
      sendBadRequest(res, "An account needs a name");
      return;
    }

    const stamp = await stampFor(req);
    const account = await FirmOfficeAccount.create({
      firmId,
      accountType: body.accountType,
      name: body.name.trim(),
      bankName: body.bankName?.trim(),
      accountNumberLast4: body.accountNumberLast4?.trim().slice(-4),
      balanceNaira: typeof body.balanceNaira === "number" ? body.balanceNaira : 0,
      asOf: body.asOf ? new Date(body.asOf) : new Date(),
      createdByName: stamp.name,
    });

    sendCreated(res, { id: String(account._id) }, "Account added");
  } catch (error) {
    sendBadRequest(res, "Failed to add the account", error);
  }
};

export const updateAccount = async (req: Request, res: Response): Promise<void> => {
  if (!assertAdmin(req, res)) return;
  try {
    const firmId = firmIdOf(req);
    const account = await FirmOfficeAccount.findOne({ _id: req.params.id, firmId });
    if (!account) {
      sendNotFound(res, "Account not found");
      return;
    }

    const body = req.body as { name?: string; balanceNaira?: number; asOf?: string };
    if (typeof body.name === "string" && body.name.trim()) account.name = body.name.trim();
    if (typeof body.balanceNaira === "number") account.balanceNaira = body.balanceNaira;
    if (body.asOf) account.asOf = new Date(body.asOf);
    // accountType is deliberately not editable: reclassifying client money as
    // the firm's own is not a field edit, it is a different account.
    account.updatedByName = (await stampFor(req)).name;
    await account.save();

    sendSuccess(res, { id: String(account._id) }, "Account updated");
  } catch (error) {
    sendBadRequest(res, "Failed to update the account", error);
  }
};

export const deleteAccount = async (req: Request, res: Response): Promise<void> => {
  if (!assertAdmin(req, res)) return;
  try {
    const firmId = firmIdOf(req);
    const deleted = await FirmOfficeAccount.findOneAndDelete({ _id: req.params.id, firmId });
    if (!deleted) {
      sendNotFound(res, "Account not found");
      return;
    }
    sendSuccess(res, { id: req.params.id }, "Account deleted");
  } catch (error) {
    sendBadRequest(res, "Failed to delete the account", error);
  }
};

// ─── The admin assistant ─────────────────────────────────────────────────────

/**
 * LE-011's admin AI box — "Ask LegalErrand — firm administration".
 *
 * This is a separate handler from `firm.ai.controller.askAssistant` on purpose.
 * That one takes a `matterContext` string from the client and will answer about
 * the work. This one builds its own context, server-side, from office data
 * only, and takes nothing from the body except the question and the prior
 * turns. There is no parameter through which a caller could hand it matter
 * content, and nothing it reads could contain any:
 *
 *  • registers — the office's own rows (title, status, dates, money, people)
 *  • counters — headcount, and matters *counted* (never read)
 *  • invoice money — totals and what is outstanding, with `lines` projected out
 *  • calendar logistics — the same allow-list `courtDiary` uses
 *  • account balances — office and client, reported apart
 *
 * No FirmDocument, DocumentVersion, DocumentComment, FirmNote, FirmMessage,
 * EvidenceItem, ReviewQueueItem or AIApprovalAction is imported into this file,
 * so there is no code path from this handler to a matter's contents. The system
 * prompt states the same limit, so the model declines rather than guesses when
 * asked something it has no business answering.
 */
const OFFICE_ADMIN_AI_CONTEXT = [
  "You are the assistant to the office manager (firm administrator) of a Nigerian law firm.",
  "You help with the running of the office: money owed and collected, suppliers, statutory",
  "deadlines to FIRS, LIRS and the pension authorities, staff leave and cover, practising",
  "certificates and NBA dues, assets, rooms, errands and the logistics around court dates.",
  "",
  "You cannot read matter content, and you must never pretend otherwise. You do not have a",
  "matter's documents, notes, messages, advice, instructions, pleadings, evidence or invoice",
  "line items, and you never will — that material is privileged and the office manager is not",
  "entitled to it. A matter may appear to you only as a name beside a diary slot or an invoice.",
  "If the question needs to know what a matter says, says who advised what, or asks you to",
  "summarise or draft anything about the substance of a case, say plainly that matter content",
  "is not available to the office manager's assistant and point them to the fee earner on it.",
  "Do not speculate about case content from a matter's name.",
  "",
  "Answer only from the OFFICE DATA given below. If the answer is not in it, say what is",
  "missing rather than inventing a figure, a date or a name.",
  "Write in plain prose only: no markdown, no asterisks, no headings, no bullet or numbered",
  "lists. The client renders raw text. Keep it to 1 to 4 short paragraphs.",
  "Money is in naira. Anything you draft for a supplier or a staff member is a draft and needs",
  "a person to approve it before it is sent.",
].join(" ");

/** Chips offered under a reply — all office work, none of it matter work. */
const OFFICE_ADMIN_CHIPS = ["Draft the chase email", "Add it to a register", "Show me next month"];

/** One register row, flattened to the few fields the model needs. */
function briefEntry(e: PresentedEntry): string {
  const bits = [
    e.title,
    e.status !== "open" ? `status ${e.status}` : null,
    e.personName ? `person ${e.personName}` : null,
    e.coverName ? `cover ${e.coverName}` : null,
    e.vendorName ? `vendor ${e.vendorName}` : null,
    e.amountNaira != null ? `₦${Math.round(e.amountNaira).toLocaleString("en-NG")}` : null,
    e.quantityTotal != null ? `${e.quantityUsed ?? 0} of ${e.quantityTotal}` : null,
    e.progressPct != null ? `${e.progressPct}%` : null,
    e.startOn ? `from ${new Date(e.startOn).toISOString().slice(0, 10)}` : null,
    e.endOn ? `to ${new Date(e.endOn).toISOString().slice(0, 10)}` : null,
    e.dueOn ? `due ${new Date(e.dueOn).toISOString().slice(0, 10)}` : null,
    e.alertTier ? `alert ${e.alertTier}` : null,
    e.location ? `at ${e.location}` : null,
    e.reference ? `ref ${e.reference}` : null,
    e.reason ? `reason ${e.reason}` : null,
  ].filter(Boolean);
  return `- ${bits.join("; ")}`;
}

/**
 * The whole of what the assistant is given. Built here rather than taken from
 * the request, which is what makes the limit above a control and not a promise.
 */
async function buildOfficeContext(firmId: string): Promise<string> {
  const today = startOfToday();
  const todayISO = today.toISOString().slice(0, 10);

  const [registers, invoices, accounts, members, matterCount, diary] = await Promise.all([
    OfficeRegisterEntry.find({ firmId }).sort({ dueOn: 1, createdAt: -1 }),
    // Money only: `lines` describe the work and are projected out.
    ClientInvoice.find({ firmId, status: { $ne: "draft" } })
      .select("reference clientName totalNaira paidNaira status dueOn")
      .sort({ dueOn: 1 })
      .lean(),
    FirmOfficeAccount.find({ firmId }).lean(),
    FirmMember.find({ firmId, isActive: true }).select("name role").sort({ name: 1 }).lean(),
    // Counted, never read.
    Matter.countDocuments({ firmId }),
    courtDiary(firmId, todayISO, addDays(today, 30).toISOString().slice(0, 10)),
  ]);

  const rows = registers.map(presentEntry);
  const byKind = new Map<string, PresentedEntry[]>();
  for (const r of rows) {
    const list = byKind.get(r.kind) ?? [];
    list.push(r);
    byKind.set(r.kind, list);
  }

  const billed = invoices.reduce((s, i) => s + (i.totalNaira ?? 0), 0);
  const collected = invoices.reduce((s, i) => s + (i.paidNaira ?? 0), 0);

  const overdue = invoices
    .map((i) => {
      const outstanding = Math.max(0, (i.totalNaira ?? 0) - (i.paidNaira ?? 0));
      const due = i.dueOn ? new Date(i.dueOn) : null;
      const days = due ? Math.round((today.getTime() - due.getTime()) / 86_400_000) : 0;
      return { reference: i.reference, clientName: i.clientName, outstanding, days };
    })
    .filter((i) => i.outstanding > 0 && i.days > 0)
    .sort((a, b) => b.days - a.days)
    .slice(0, 20);

  const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
  const sumOf = (t: "office" | "client") =>
    accounts.filter((a) => a.accountType === t).reduce((s, a) => s + (a.balanceNaira ?? 0), 0);

  const parts: string[] = [
    `OFFICE DATA. Today is ${todayISO}.`,
    "",
    "PEOPLE (name and role only):",
    members.length
      ? members.map((m) => `- ${m.name}, ${m.role.replace(/_/g, " ")}`).join("\n")
      : "- none recorded",
    "",
    `COUNTERS: headcount ${members.length}; matters open ${matterCount} (a count only — the contents of a matter are not available to you).`,
    "",
    "MONEY (totals and balances only; invoice line items are not available to you):",
    `- billed ${naira(billed)}; collected ${naira(collected)}; outstanding ${naira(Math.max(0, billed - collected))}`,
    `- office account balance ${naira(sumOf("office"))}`,
    `- client account balance ${naira(sumOf("client"))} — held on trust, never the firm's, and never added to the office account`,
    "",
    "INVOICES OVERDUE (oldest first; anything past 60 days is reported to the partners weekly):",
    overdue.length
      ? overdue
          .map(
            (i) =>
              `- ${i.reference}, ${i.clientName}, ${naira(i.outstanding)} outstanding, ${i.days} days overdue`
          )
          .join("\n")
      : "- nothing overdue",
    "",
    "COURT DIARY, NEXT 30 DAYS — logistics only (who goes where and when). What the matter says is not available to you:",
    diary.length
      ? diary
          .map(
            (d) =>
              `- ${d.date}${d.time ? ` ${d.time}` : ""}, ${d.type}, matter "${d.matterName ?? "unnamed"}", attending ${d.lawyer ?? "nobody recorded"}, at ${d.location ?? "no venue recorded"}`
          )
          .join("\n")
      : "- nothing in the diary",
  ];

  for (const kind of OFFICE_REGISTER_KINDS) {
    const list = byKind.get(kind);
    if (!list?.length) continue;
    parts.push("", `REGISTER ${kind.replace(/_/g, " ").toUpperCase()}:`);
    parts.push(list.slice(0, 40).map(briefEntry).join("\n"));
  }

  return parts.join("\n");
}

export const askOfficeAdmin = async (req: Request, res: Response): Promise<void> => {
  if (!assertAdmin(req, res)) return;
  try {
    const firmId = firmIdOf(req);
    // Only the question and the prior turns. Deliberately no `matterContext`:
    // there is no parameter here through which matter content could be injected.
    const { message, history } = req.body as {
      message?: string;
      history?: Array<{ role?: string; content?: string }>;
    };

    if (!message || !message.trim()) {
      sendBadRequest(res, "Ask a question first");
      return;
    }

    const priorTurns: ConversationMessage[] = Array.isArray(history)
      ? history
          .filter((m) => typeof m?.content === "string" && m.content.trim())
          .slice(-10)
          .map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: String(m.content),
            timestamp: new Date(),
          }))
      : [];

    const context = await buildOfficeContext(firmId);

    const reply = await deepseekService.chatWithHistory(
      [...priorTurns, { role: "user", content: message.trim(), timestamp: new Date() }],
      `${OFFICE_ADMIN_AI_CONTEXT}\n\n${context}`
    );

    sendSuccess(
      res,
      {
        reply,
        chips: OFFICE_ADMIN_CHIPS,
        cannotSee: [
          "anything a matter says — its documents, notes, messages or AI activity",
          "invoice line items, which describe the work done",
          "advice given to a client",
          "another firm's data",
        ],
      },
      "Assistant reply generated"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to answer the question", error);
  }
};
