import { Response } from "express";
import { Types } from "mongoose";
import { AdminRequest } from "../../types";
import {
  AdminAuditLog,
  Client,
  Firm,
  FirmActivityLog,
  FirmDocument,
  FirmMember,
  FirmTask,
  FirmTimeEntry,
  Matter,
  Subscription,
  SupportTicket,
  UNRESOLVED_TICKET_STATUSES,
  PAYING_STATUSES,
} from "../../models/firm";
import { sendSuccess, sendNotFound, sendError } from "../../utils/response";

const DAY_MS = 86_400_000;

/** `days` from the query, clamped to something a dashboard can actually draw. */
function windowFrom(query: Record<string, unknown>, fallback = 30): Date {
  const asked = parseInt(String(query.days ?? ""), 10);
  const days = Number.isFinite(asked) ? Math.min(365, Math.max(1, asked)) : fallback;
  return new Date(Date.now() - days * DAY_MS);
}

function shape(row: {
  _id: Types.ObjectId;
  type: string;
  summary: string;
  reference?: string;
  city?: string;
  ipPrefix?: string;
  suspicious: boolean;
  at: Date;
  memberId?: { name?: string; role?: string } | Types.ObjectId | null;
  firmId?: { name?: string } | Types.ObjectId | null;
}) {
  const member = row.memberId && "name" in row.memberId ? row.memberId : null;
  const firm = row.firmId && "name" in row.firmId ? row.firmId : null;
  return {
    id: row._id.toString(),
    type: row.type,
    summary: row.summary,
    reference: row.reference ?? null,
    person: member?.name ?? null,
    personRole: member?.role ?? null,
    firm: firm?.name ?? null,
    city: row.city ?? null,
    ipPrefix: row.ipPrefix ?? null,
    suspicious: row.suspicious,
    at: row.at,
  };
}

/**
 * GET /admin/firms/:id/activity
 *
 * Metadata only — see the boundary note on FirmActivityLog. Matters and
 * documents come back as reference numbers, and nothing a client said is here.
 */
export const getFirmActivity = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    if (!Types.ObjectId.isValid(id)) {
      sendNotFound(res, "Firm not found");
      return;
    }

    const { type, memberId, page = "1", limit = "120" } = req.query as Record<string, string>;
    const pageNumber = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(limit) || 120));

    const filter: Record<string, unknown> = { firmId: id, at: { $gte: windowFrom(req.query) } };
    if (type) filter.type = type;
    if (memberId && Types.ObjectId.isValid(memberId)) filter.memberId = memberId;

    const [rows, total] = await Promise.all([
      FirmActivityLog.find(filter)
        .populate("memberId", "name role")
        .sort({ at: -1 })
        .skip((pageNumber - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      FirmActivityLog.countDocuments(filter),
    ]);

    sendSuccess(res, rows.map(shape), "Activity retrieved", 200, {
      page: pageNumber,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    sendError(res, "Failed to retrieve activity", 500, (err as Error).message);
  }
};

/** GET /admin/firms/activity — the same, across every firm. */
export const getAllActivity = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { type, country, state, page = "1", limit = "120" } = req.query as Record<string, string>;
    const pageNumber = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(limit) || 120));

    const filter: Record<string, unknown> = { at: { $gte: windowFrom(req.query) } };
    if (type) filter.type = type;
    // Location lives on the firm, so it is resolved to an id list first.
    if (country || state) {
      const where: Record<string, unknown> = {};
      if (country) where.country = country;
      if (state) where.state = state;
      const firms = await Firm.find(where).select("_id").lean();
      filter.firmId = { $in: firms.map((f) => f._id) };
    }

    const [rows, total] = await Promise.all([
      FirmActivityLog.find(filter)
        .populate("memberId", "name role")
        .populate("firmId", "name")
        .sort({ at: -1 })
        .skip((pageNumber - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      FirmActivityLog.countDocuments(filter),
    ]);

    const since = new Date(Date.now() - DAY_MS);
    const [today, failedSignins, firmsActive] = await Promise.all([
      FirmActivityLog.countDocuments({ at: { $gte: since } }),
      FirmActivityLog.countDocuments({ at: { $gte: since }, suspicious: true }),
      FirmActivityLog.distinct("firmId", { at: { $gte: since } }),
    ]);

    sendSuccess(res, rows.map(shape), "Activity retrieved", 200, {
      page: pageNumber,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      last24Hours: {
        actions: today,
        firmsActive: firmsActive.length,
        failedSignins,
      },
    });
  } catch (err) {
    sendError(res, "Failed to retrieve activity", 500, (err as Error).message);
  }
};

/** GET /admin/firms/:id/usage — what one firm actually does with LegalErrand. */
export const getFirmUsage = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    if (!Types.ObjectId.isValid(id)) {
      sendNotFound(res, "Firm not found");
      return;
    }

    const since = windowFrom(req.query);
    const [matters, documents, tasks, timeEntries, clients, byType, subscription] =
      await Promise.all([
        Matter.countDocuments({ firmId: id }),
        FirmDocument.countDocuments({ firmId: id }),
        FirmTask.countDocuments({ firmId: id }),
        FirmTimeEntry.countDocuments({ firmId: id }),
        Client.countDocuments({ firmId: id }),
        FirmActivityLog.aggregate<{ _id: string; count: number }>([
          { $match: { firmId: new Types.ObjectId(id), at: { $gte: since } } },
          { $group: { _id: "$type", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        Subscription.findOne({ firmId: id }).select("plan mrr").lean(),
      ]);

    sendSuccess(
      res,
      {
        totals: { matters, documents, tasks, timeEntries, clients },
        activityByType: byType.map((row) => ({ type: row._id, actions: row.count })),
        plan: subscription?.plan ?? null,
        mrr: subscription?.mrr ?? 0,
        // What the AI costs is not measured anywhere yet — no usage is metered
        // against a provider — so it is absent rather than estimated.
        aiCost: null,
      },
      "Usage retrieved"
    );
  } catch (err) {
    sendError(res, "Failed to retrieve usage", 500, (err as Error).message);
  }
};

/** GET /admin/firms/usage — load across the platform. */
export const getPlatformUsage = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const since = windowFrom(req.query);

    const [daily, byType, totals] = await Promise.all([
      // One bucket per day: how many distinct people did anything.
      FirmActivityLog.aggregate<{ _id: string; people: number; actions: number }>([
        { $match: { at: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$at" } },
            people: { $addToSet: "$memberId" },
            actions: { $sum: 1 },
          },
        },
        { $project: { people: { $size: "$people" }, actions: 1 } },
        { $sort: { _id: 1 } },
      ]),
      // Actions per kind, and — separately — how many distinct firms did each
      // kind at all. The second is what "adoption" means; counting actions and
      // calling it adoption would flatter a single busy firm into a trend.
      FirmActivityLog.aggregate<{ _id: string; count: number; firms: string[] }>([
        { $match: { at: { $gte: since } } },
        { $group: { _id: "$type", count: { $sum: 1 }, firms: { $addToSet: "$firmId" } } },
        { $sort: { count: -1 } },
      ]),
      Promise.all([
        Matter.countDocuments(),
        FirmDocument.countDocuments(),
        FirmTask.countDocuments(),
        Client.countDocuments(),
      ]),
    ]);

    const [matters, documents, tasks, clients] = totals;
    const firmsWithAny = await FirmActivityLog.distinct("firmId", { at: { $gte: since } });
    const firmCount = await Firm.countDocuments();

    sendSuccess(
      res,
      {
        daily: daily.map((row) => ({ date: row._id, people: row.people, actions: row.actions })),
        byType: byType.map((row) => ({ type: row._id, actions: row.count })),
        totals: { matters, documents, tasks, clients },
        // Feature adoption, honestly: the share of firms that have done each kind
        // of thing at all in the window.
        adoption: byType.map((row) => ({
          type: row._id,
          firms: row.firms.length,
          percent: firmCount ? Math.round((row.firms.length / firmCount) * 100) : 0,
        })),
        firmsActive: firmsWithAny.length,
        firms: firmCount,
        aiCost: null,
      },
      "Platform usage retrieved"
    );
  } catch (err) {
    sendError(res, "Failed to retrieve platform usage", 500, (err as Error).message);
  }
};

/** GET /admin/firms/geography — firms by country, then by state. */
export const getGeography = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const country = req.query.country ? String(req.query.country) : null;

    const firms = await Firm.find().select("name country state").lean();
    const subscriptions = await Subscription.find().select("firmId status mrr seats").lean();
    const byFirm = new Map(subscriptions.map((s) => [s.firmId.toString(), s]));
    const seatsUsed = await FirmMember.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { isActive: true } },
      { $group: { _id: "$firmId", count: { $sum: 1 } } },
    ]);
    const peopleAt = new Map(seatsUsed.map((row) => [row._id.toString(), row.count]));

    const tally = (rows: typeof firms) => {
      let paying = 0;
      let mrr = 0;
      let people = 0;
      for (const firm of rows) {
        const subscription = byFirm.get(firm._id.toString());
        if (subscription && PAYING_STATUSES.includes(subscription.status)) {
          paying++;
          mrr += subscription.mrr;
        }
        people += peopleAt.get(firm._id.toString()) ?? 0;
      }
      return { firms: rows.length, paying, mrr, people };
    };

    const countries = [...new Set(firms.map((f) => f.country).filter(Boolean))]
      .map((name) => ({ country: name, ...tally(firms.filter((f) => f.country === name)) }))
      .sort((a, b) => b.firms - a.firms);

    // Only the asked-for country is broken down; sending every state of every
    // country would be most of a gazetteer.
    const states = country
      ? [
          ...new Set(
            firms.filter((f) => f.country === country && f.state).map((f) => f.state as string)
          ),
        ]
          .map((name) => ({
            state: name,
            ...tally(firms.filter((f) => f.country === country && f.state === name)),
          }))
          .sort((a, b) => b.firms - a.firms || a.state.localeCompare(b.state))
      : [];

    sendSuccess(res, { countries, country, states }, "Geography retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve geography", 500, (err as Error).message);
  }
};

/** GET /admin/firms/people — everyone at every firm. */
export const getAllPeople = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const {
      role,
      country,
      state,
      q,
      page = "1",
      limit = "100",
    } = req.query as Record<string, string>;
    const pageNumber = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(300, Math.max(1, parseInt(limit) || 100));

    const filter: Record<string, unknown> = {};
    if (role) filter.role = role;
    if (q) {
      const term = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ name: term }, { email: term }];
    }
    if (country || state) {
      const where: Record<string, unknown> = {};
      if (country) where.country = country;
      if (state) where.state = state;
      const firms = await Firm.find(where).select("_id").lean();
      filter.firmId = { $in: firms.map((f) => f._id) };
    }

    const [members, total, neverSignedIn, activeLastSevenDays] = await Promise.all([
      FirmMember.find(filter)
        .populate("firmId", "name country state")
        .select("name email role isActive lastLogin firmId")
        .sort({ name: 1 })
        .skip((pageNumber - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      FirmMember.countDocuments(filter),
      FirmMember.countDocuments({ ...filter, lastLogin: { $exists: false } }),
      FirmMember.countDocuments({
        ...filter,
        lastLogin: { $gte: new Date(Date.now() - 7 * DAY_MS) },
      }),
    ]);

    sendSuccess(
      res,
      members.map((member) => {
        const firm = member.firmId as unknown as {
          _id: Types.ObjectId;
          name?: string;
          country?: string;
          state?: string;
        } | null;
        return {
          id: member._id.toString(),
          name: member.name,
          email: member.email,
          role: member.role,
          status: !member.isActive ? "suspended" : member.lastLogin ? "active" : "invited",
          lastLoginAt: member.lastLogin ?? null,
          firm: firm
            ? {
                id: firm._id.toString(),
                name: firm.name ?? null,
                country: firm.country ?? null,
                state: firm.state ?? null,
              }
            : null,
        };
      }),
      "People retrieved",
      200,
      {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        // A seat paid for and never taken up is money the firm is wasting.
        neverSignedIn,
        activeLastSevenDays,
      }
    );
  } catch (err) {
    sendError(res, "Failed to retrieve people", 500, (err as Error).message);
  }
};

/** GET /admin/firms/tickets */
export const listTickets = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { view = "open", firmId } = req.query as Record<string, string>;

    const filter: Record<string, unknown> = {};
    if (view === "open") filter.status = { $in: UNRESOLVED_TICKET_STATUSES };
    else if (view === "resolved") filter.status = "resolved";
    if (firmId && Types.ObjectId.isValid(firmId)) filter.firmId = firmId;

    const tickets = await SupportTicket.find(filter)
      .populate("firmId", "name")
      .sort({ status: 1, priority: 1, openedAt: -1 })
      .limit(300)
      .lean();

    const [open, urgent, resolvedWithin24h, resolvedTotal] = await Promise.all([
      SupportTicket.countDocuments({ status: { $in: UNRESOLVED_TICKET_STATUSES } }),
      SupportTicket.countDocuments({
        status: { $in: UNRESOLVED_TICKET_STATUSES },
        priority: "urgent",
      }),
      SupportTicket.countDocuments({
        status: "resolved",
        $expr: { $lte: [{ $subtract: ["$resolvedAt", "$openedAt"] }, DAY_MS] },
      }),
      SupportTicket.countDocuments({ status: "resolved" }),
    ]);

    sendSuccess(
      res,
      tickets.map((ticket) => {
        const firm = ticket.firmId as unknown as { _id: Types.ObjectId; name?: string } | null;
        return {
          id: ticket._id.toString(),
          reference: ticket.reference,
          subject: ticket.subject,
          priority: ticket.priority,
          status: ticket.status,
          team: ticket.team,
          openedAt: ticket.openedAt,
          firstRepliedAt: ticket.firstRepliedAt ?? null,
          resolvedAt: ticket.resolvedAt ?? null,
          firm: firm ? { id: firm._id.toString(), name: firm.name ?? null } : null,
        };
      }),
      "Tickets retrieved",
      200,
      {
        open,
        urgent,
        resolvedWithin24hPercent: resolvedTotal
          ? Math.round((resolvedWithin24h / resolvedTotal) * 100)
          : null,
        // Satisfaction is not collected anywhere, so it is absent rather than
        // invented.
        satisfaction: null,
      }
    );
  } catch (err) {
    sendError(res, "Failed to retrieve tickets", 500, (err as Error).message);
  }
};

/** GET /admin/firms/audit — what admins and the system did. */
export const getAuditLog = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { firmId, page = "1", limit = "100" } = req.query as Record<string, string>;
    const pageNumber = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(300, Math.max(1, parseInt(limit) || 100));

    const filter: Record<string, unknown> = {};
    if (firmId && Types.ObjectId.isValid(firmId)) filter.firmId = firmId;

    const [rows, total] = await Promise.all([
      AdminAuditLog.find(filter)
        .sort({ at: -1 })
        .skip((pageNumber - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      AdminAuditLog.countDocuments(filter),
    ]);

    sendSuccess(
      res,
      rows.map((row) => ({
        id: row._id.toString(),
        who: row.adminName,
        action: row.action,
        firm: row.firmName ?? null,
        firmId: row.firmId?.toString() ?? null,
        detail: row.detail ?? null,
        at: row.at,
      })),
      "Audit log retrieved",
      200,
      { page: pageNumber, limit: pageSize, total, totalPages: Math.ceil(total / pageSize) }
    );
  } catch (err) {
    sendError(res, "Failed to retrieve the audit log", 500, (err as Error).message);
  }
};

/**
 * GET /admin/firms/system
 *
 * Nothing measures uptime or latency in this repo — there is no monitor, no
 * metrics store and no health probe beyond the process being up. Rather than
 * return invented figures that would look exactly like real ones, this says so,
 * and the dashboard shows the screen as not instrumented.
 *
 * When a monitor arrives, fill `services` and flip `instrumented`.
 */
export const getSystemHealth = (_req: AdminRequest, res: Response): void => {
  sendSuccess(
    res,
    {
      instrumented: false,
      reason: "No uptime monitor is connected. These figures are not measured.",
      services: [],
      incidents: [],
      uptime: null,
      latency: null,
      errorRate: null,
    },
    "System health is not instrumented yet"
  );
};
