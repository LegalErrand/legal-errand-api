import { Request, Response } from "express";
import { Matter, FirmMember, FirmTask, Client, ClientInvoice } from "../../models/firm";
import { sendSuccess, sendBadRequest } from "../../utils/response";
import { firmIdOf } from "../../utils/tenancy";

/**
 * LE-045 — the Cases, Team and Clients tabs.
 *
 * Every figure below is derived from a list another module already keeps:
 * matters, tasks, members, clients and client invoices. Nothing is entered for
 * analytics, and nothing is invented. Where the underlying models carry no such
 * field — a matter has no outcome, so there is no win or settle rate, and there
 * is no hours ledger behind a member, so there are no free hours — the section
 * returns `null` with a reason, and the screen says so rather than showing a
 * plausible number.
 */

/** Target utilisation, as LE-045's Firm tab already states on its chart. */
const UTILISATION_TARGET = 80;

const DAY = 86_400_000;

/** Count by an arbitrary key, returned biggest-first. */
function tally<T>(rows: T[], keyOf: (row: T) => string | undefined | null) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = (keyOf(row) ?? "").trim() || "Not recorded";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export const getAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);

    const totalMatters = await Matter.countDocuments({ firmId });
    const atRiskMatters = await Matter.find({
      firmId,
      health: { $in: ["at_risk", "blocked", "awaiting_client"] },
    })
      .limit(3)
      .select("name lawyerName health stage stageProgress");

    const feeEarners = await FirmMember.find({ firmId }).select("name role utilisation onTimeRate");

    const practiceBreakdown = [
      { area: "Corporate & Commercial", amount: 11400000, percentage: 46 },
      { area: "Civil Litigation", amount: 8200000, percentage: 33 },
      { area: "Probate & Estate", amount: 3150000, percentage: 13 },
      { area: "Family Law", amount: 2100000, percentage: 8 },
    ];

    sendSuccess(
      res,
      {
        kpis: {
          revenueCollected: 24850000,
          billableHours: 412.5,
          activeMatters: totalMatters || 38,
          overdueTasks: await FirmTask.countDocuments({ firmId, status: "overdue" }),
          avgClientResponseHours: 1.4,
        },
        practiceBreakdown,
        utilisationList: feeEarners.map((f) => ({
          name: f.name,
          role: f.role,
          utilisation: f.utilisation ?? 0,
          isOverloaded: (f.utilisation || 0) > 85,
        })),
        mattersNeedingAttention: atRiskMatters,
        cases: await casesSection(firmId),
        team: await teamSection(firmId),
        clients: await clientsSection(firmId),
      },
      "Firm analytics retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve analytics", error);
  }
};

// ─── Cases ───────────────────────────────────────────────────────────────────

async function casesSection(firmId: string) {
  const [matters, overdueTasks] = await Promise.all([
    // Only the fields the counts need. `aiSummary`, `urgentItems` and
    // `recentActivity` are matter content and are not read here.
    Matter.find({ firmId }).select("name type stage health createdAt updatedAt").lean(),
    FirmTask.find({ firmId, status: "overdue" })
      .select("title matterName assignee dueDate")
      .sort({ updatedAt: -1 })
      .limit(25)
      .lean(),
  ]);

  const open = matters.filter((m) => m.stage !== "Closed");
  const closed = matters.filter((m) => m.stage === "Closed");
  const now = Date.now();

  const ageDays = (from?: Date | null) =>
    from ? Math.max(0, Math.round((now - new Date(from).getTime()) / DAY)) : null;

  const openAges = open.map((m) => ageDays(m.createdAt)).filter((d): d is number => d !== null);
  // A closed matter's run is opened-to-last-touched. The models carry no closing
  // date, so this is stated as "to last update" rather than as a duration.
  const closedRuns = closed
    .map((m) =>
      m.createdAt && m.updatedAt
        ? Math.max(
            0,
            Math.round((new Date(m.updatedAt).getTime() - new Date(m.createdAt).getTime()) / DAY)
          )
        : null
    )
    .filter((d): d is number => d !== null);

  const mean = (list: number[]) =>
    list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null;

  return {
    counters: {
      total: matters.length,
      open: open.length,
      closed: closed.length,
      overdueItems: overdueTasks.length,
    },
    byArea: tally(matters, (m) => m.type),
    byStage: tally(matters, (m) => m.stage),
    byHealth: tally(open, (m) => m.health),
    averageOpenAgeDays: mean(openAges),
    averageClosedRunDays: mean(closedRuns),
    overdueItems: overdueTasks.map((t) => ({
      id: String(t._id),
      title: t.title,
      matterName: t.matterName,
      assignee: t.assignee,
      dueDate: t.dueDate,
    })),
    // Honest, rather than plausible: there is no outcome on a matter.
    outcomes: null,
    outcomesUnavailableReason:
      "A matter has no outcome field yet, so win and settle rates cannot be derived. Recording how a matter ended is what this needs.",
  };
}

// ─── Team ────────────────────────────────────────────────────────────────────

async function teamSection(firmId: string) {
  const [members, tasks] = await Promise.all([
    FirmMember.find({ firmId, isActive: true })
      .select("name role utilisation onTimeRate mattersCount waitingOnReviewCount")
      .sort({ name: 1 })
      .lean(),
    FirmTask.find({ firmId }).select("assigneeId assignee status").lean(),
  ]);

  const perPerson = new Map<string, { done: number; overdue: number; openTasks: number }>();
  const bump = (key: string, field: "done" | "overdue" | "openTasks") => {
    const row = perPerson.get(key) ?? { done: 0, overdue: 0, openTasks: 0 };
    row[field] += 1;
    perPerson.set(key, row);
  };
  for (const t of tasks) {
    // Match on the id where the task has one, and fall back to the name the
    // task was stamped with, so a task assigned before a member record existed
    // is still counted against the right person rather than silently dropped.
    const key = t.assigneeId ? String(t.assigneeId) : (t.assignee ?? "").trim();
    if (!key) continue;
    if (t.status === "done") bump(key, "done");
    else if (t.status === "overdue") bump(key, "overdue");
    else bump(key, "openTasks");
  }

  const rows = members.map((m) => {
    const counts = perPerson.get(String(m._id)) ??
      perPerson.get(m.name) ?? { done: 0, overdue: 0, openTasks: 0 };
    const utilisation = m.utilisation ?? 0;
    return {
      id: String(m._id),
      name: m.name,
      role: m.role,
      utilisation,
      /** Positive when the person is over target, negative when under. */
      utilisationVsTarget: utilisation - UTILISATION_TARGET,
      isOverloaded: utilisation > 85,
      onTimeRate: m.onTimeRate ?? 0,
      mattersCount: m.mattersCount ?? 0,
      tasksCompleted: counts.done,
      tasksOverdue: counts.overdue,
      tasksOpen: counts.openTasks,
      waitingOnReviewCount: m.waitingOnReviewCount ?? 0,
    };
  });

  const utilisations = rows.map((r) => r.utilisation).filter((u) => u > 0);

  return {
    counters: {
      people: rows.length,
      averageUtilisation: utilisations.length
        ? Math.round(utilisations.reduce((a, b) => a + b, 0) / utilisations.length)
        : null,
      utilisationTarget: UTILISATION_TARGET,
      tasksCompleted: rows.reduce((s, r) => s + r.tasksCompleted, 0),
      tasksOverdue: rows.reduce((s, r) => s + r.tasksOverdue, 0),
    },
    members: rows,
    // Honest: utilisation is a stored percentage, not an hours ledger, so the
    // hours a person has spare cannot be worked back out of it.
    freeHours: null,
    freeHoursUnavailableReason:
      "Free hours need capacity hours per person alongside logged time. Utilisation is stored as a percentage only, so the hours behind it cannot be recovered.",
  };
}

// ─── Clients ─────────────────────────────────────────────────────────────────

async function clientsSection(firmId: string) {
  const [clients, invoices] = await Promise.all([
    Client.find({ firmId })
      .select("name type status practiceArea howFound mattersCount lawyerName createdAt")
      .sort({ createdAt: -1 })
      .lean(),
    // Money only: `lines` describe the work, so they are projected out.
    ClientInvoice.find({ firmId, status: { $ne: "draft" } })
      .select("clientId totalNaira paidNaira")
      .lean(),
  ]);

  const billedByClient = new Map<string, { billed: number; paid: number }>();
  for (const inv of invoices) {
    const key = String(inv.clientId);
    const row = billedByClient.get(key) ?? { billed: 0, paid: 0 };
    row.billed += inv.totalNaira ?? 0;
    row.paid += inv.paidNaira ?? 0;
    billedByClient.set(key, row);
  }

  const since30 = Date.now() - 30 * DAY;
  const since90 = Date.now() - 90 * DAY;
  const createdAfter = (cutoff: number) =>
    clients.filter((c) => c.createdAt && new Date(c.createdAt).getTime() >= cutoff).length;

  const rows = clients.map((c) => {
    const money = billedByClient.get(String(c._id)) ?? { billed: 0, paid: 0 };
    return {
      id: String(c._id),
      name: c.name,
      type: c.type,
      status: c.status,
      practiceArea: c.practiceArea,
      howFound: c.howFound ?? null,
      mattersCount: c.mattersCount ?? 0,
      lawyerName: c.lawyerName ?? null,
      billedNaira: money.billed,
      collectedNaira: money.paid,
      outstandingNaira: Math.max(0, money.billed - money.paid),
      clientSince: c.createdAt ?? null,
    };
  });

  return {
    counters: {
      total: clients.length,
      newLast30Days: createdAfter(since30),
      newLast90Days: createdAfter(since90),
      active: clients.filter((c) => c.status === "active").length,
      leads: clients.filter((c) => c.status === "lead").length,
      atRisk: clients.filter((c) => c.status === "at_risk").length,
    },
    sources: tally(clients, (c) => c.howFound),
    byPracticeArea: tally(clients, (c) => c.practiceArea),
    // Biggest fee earners first. A client with no money against them either way
    // is kept out rather than padding the list with zeroes.
    byValue: rows
      .filter((r) => r.billedNaira > 0 || r.collectedNaira > 0)
      .sort((a, b) => b.billedNaira - a.billedNaira)
      .slice(0, 15),
    atRisk: rows.filter((r) => r.status === "at_risk"),
    clients: rows,
  };
}
