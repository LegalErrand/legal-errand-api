import { Response } from "express";
import { Types } from "mongoose";
import { AdminRequest } from "../../types";
import {
  Firm,
  FirmMember,
  Matter,
  FirmDocument,
  FirmTask,
  FirmTimeEntry,
  Client,
  Subscription,
  ISubscription,
  PAYING_STATUSES,
  SUBSCRIPTION_STATUSES,
} from "../../models/firm";
import { FirmPlan, PLAN_CATALOGUE, isFirmPlan, nextPlanUp } from "../../config/plans";
import { sendSuccess, sendNotFound, sendError } from "../../utils/response";

const DAY_MS = 86_400_000;

/** Columns a person can sort the firm list by, and how each one reads. */
const SORTABLE = ["name", "plan", "mrr", "seats", "createdAt"] as const;
type SortKey = (typeof SORTABLE)[number];

/**
 * How healthy a firm looks, 0–100, from four things we can actually observe.
 * It is computed on read rather than stored, so it can never be stale, and the
 * four parts come back alongside it — a score nobody can explain is a score
 * nobody should act on.
 *
 * Note on the first part: until there is a sign-in log (see FirmActivityLog),
 * "people signing in" is approximated by members whose lastLogin falls inside
 * the window. That undercounts a firm where one person signs in daily and the
 * rest never do, which is the right way to be wrong here.
 */
export function healthFor(input: {
  membersActiveLately: number;
  memberCount: number;
  seatsUsed: number;
  seats: number;
  featuresUsed: number;
  paymentsOnTime: boolean;
}): { score: number; parts: { label: string; percent: number }[] } {
  const parts = [
    {
      label: "People signing in (last 7 days)",
      percent: input.memberCount
        ? Math.round((input.membersActiveLately / input.memberCount) * 100)
        : 0,
    },
    {
      label: "Seats in use",
      percent: input.seats ? Math.min(100, Math.round((input.seatsUsed / input.seats) * 100)) : 0,
    },
    // Five things a firm can do with LegalErrand: matters, documents, tasks,
    // time entries, clients. Touching all five is a firm that has settled in.
    { label: "Features used", percent: Math.min(100, Math.round((input.featuresUsed / 5) * 100)) },
    { label: "Payments on time", percent: input.paymentsOnTime ? 100 : 20 },
  ];

  const score = Math.round(parts.reduce((total, p) => total + p.percent, 0) / parts.length);
  return { score, parts };
}

/** Everything about one firm that does not need a second round trip to count. */
async function summarise(firm: InstanceType<typeof Firm>, subscription: ISubscription | null) {
  const firmId = firm._id as Types.ObjectId;
  const sevenDaysAgo = new Date(Date.now() - 7 * DAY_MS);

  const [
    members,
    activeLately,
    owner,
    lastActive,
    matters,
    documents,
    tasks,
    timeEntries,
    clients,
  ] = await Promise.all([
    FirmMember.countDocuments({ firmId, isActive: true }),
    FirmMember.countDocuments({ firmId, isActive: true, lastLogin: { $gte: sevenDaysAgo } }),
    FirmMember.findOne({ firmId, role: "managing_partner" }).select("name email").lean(),
    FirmMember.findOne({ firmId, lastLogin: { $exists: true } })
      .sort({ lastLogin: -1 })
      .select("lastLogin")
      .lean(),
    Matter.countDocuments({ firmId }),
    FirmDocument.countDocuments({ firmId }),
    FirmTask.countDocuments({ firmId }),
    FirmTimeEntry.countDocuments({ firmId }),
    Client.countDocuments({ firmId }),
  ]);

  const seats = subscription?.seats ?? firm.feeEarnerCapacity;
  const featuresUsed = [matters, documents, tasks, timeEntries, clients].filter(
    (n) => n > 0
  ).length;
  const health = healthFor({
    membersActiveLately: activeLately,
    memberCount: members,
    seatsUsed: members,
    seats,
    featuresUsed,
    paymentsOnTime: subscription?.status !== "past_due",
  });

  const plan = (subscription?.plan ?? null) as FirmPlan | null;

  return {
    id: firmId.toString(),
    name: firm.name,
    owner: owner?.name ?? null,
    email: owner?.email ?? firm.contactEmail,
    jurisdiction: firm.jurisdiction,
    country: firm.country,
    state: firm.state ?? null,
    plan,
    planLabel: plan ? PLAN_CATALOGUE[plan].label : null,
    readyForPlan: plan && members >= seats ? nextPlanUp(plan) : null,
    // A firm with no subscription row has not been set up commercially yet.
    // Saying so beats inventing a status for it.
    status: subscription?.status ?? "unknown",
    seats,
    seatsUsed: members,
    mrr: subscription?.mrr ?? 0,
    trialEndsAt: subscription?.trialEndsAt ?? null,
    renewsAt: subscription?.renewsAt ?? null,
    joinedAt: firm.createdAt,
    lastActiveAt: lastActive?.lastLogin ?? null,
    health: health.score,
    healthParts: health.parts,
    usage: { matters, documents, tasks, timeEntries, clients },
  };
}

/**
 * GET /admin/firms
 *
 * Filtering happens across two collections: the firm's own fields and its
 * subscription's. The subscription side is resolved first and folded into the
 * firm query as an id list, which keeps one query per request rather than one
 * per firm.
 */
export const listFirms = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const {
      page = "1",
      limit = "50",
      status,
      plan,
      country,
      state,
      q,
      sort = "mrr",
      dir,
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(limit) || 50));

    const firmFilter: Record<string, unknown> = {};
    if (country) firmFilter.country = country;
    if (state) firmFilter.state = state;
    if (q) {
      const term = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      firmFilter.$or = [{ name: term }, { contactEmail: term }];
    }

    // Only reach for subscriptions when something actually filters on them.
    const subscriptionFilter: Record<string, unknown> = {};
    if (status) subscriptionFilter.status = status;
    if (plan) subscriptionFilter.plan = plan;
    if (Object.keys(subscriptionFilter).length) {
      const matching = await Subscription.find(subscriptionFilter).select("firmId").lean();
      firmFilter._id = { $in: matching.map((s) => s.firmId) };
    }

    const sortKey: SortKey = (SORTABLE as readonly string[]).includes(sort)
      ? (sort as SortKey)
      : "mrr";
    const direction = dir === "asc" ? 1 : -1;

    const [firms, total] = await Promise.all([
      Firm.find(firmFilter)
        .sort(sortKey === "name" ? { name: direction } : { createdAt: -1 })
        .skip((pageNumber - 1) * pageSize)
        .limit(pageSize),
      Firm.countDocuments(firmFilter),
    ]);

    const subscriptions = await Subscription.find({
      firmId: { $in: firms.map((f) => f._id) },
    });
    const byFirm = new Map(subscriptions.map((s) => [s.firmId.toString(), s]));

    const rows = await Promise.all(
      firms.map((firm) =>
        summarise(firm, byFirm.get((firm._id as Types.ObjectId).toString()) ?? null)
      )
    );

    // mrr, plan and seats live on the subscription, so they are ordered after
    // the join rather than in the firm query.
    if (sortKey !== "name") {
      rows.sort((a, b) => {
        const left =
          sortKey === "plan"
            ? (a.plan ?? "")
            : sortKey === "seats"
              ? a.seatsUsed
              : sortKey === "createdAt"
                ? +new Date(a.joinedAt)
                : a.mrr;
        const right =
          sortKey === "plan"
            ? (b.plan ?? "")
            : sortKey === "seats"
              ? b.seatsUsed
              : sortKey === "createdAt"
                ? +new Date(b.joinedAt)
                : b.mrr;
        return (left > right ? 1 : left < right ? -1 : 0) * direction;
      });
    }

    sendSuccess(res, rows, "Firms retrieved", 200, {
      page: pageNumber,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    sendError(res, "Failed to list firms", 500, (err as Error).message);
  }
};

/**
 * GET /admin/firms/metrics
 *
 * The figures the business is judged on. Computed from subscriptions, so they
 * always agree with what the firm list shows.
 */
export const getFirmMetrics = async (_req: AdminRequest, res: Response): Promise<void> => {
  try {
    const [subscriptions, firmCount, seatsUsed] = await Promise.all([
      Subscription.find().select("plan status seats mrr trialEndsAt").lean(),
      Firm.countDocuments(),
      FirmMember.countDocuments({ isActive: true }),
    ]);

    const paying = subscriptions.filter((s) => PAYING_STATUSES.includes(s.status));
    const trialing = subscriptions.filter((s) => s.status === "trialing");
    const churned = subscriptions.filter((s) => s.status === "churned");

    const mrr = paying.reduce((total, s) => total + s.mrr, 0);
    const seatsSold = paying.reduce((total, s) => total + s.seats, 0);

    const byPlan = Object.keys(PLAN_CATALOGUE).map((plan) => {
      const onPlan = paying.filter((s) => s.plan === plan);
      return {
        plan,
        label: PLAN_CATALOGUE[plan as FirmPlan].label,
        firms: onPlan.length,
        mrr: onPlan.reduce((total, s) => total + s.mrr, 0),
      };
    });

    // A trial about to lapse is the most time-sensitive thing on the dashboard.
    const soon = new Date(Date.now() + 3 * DAY_MS);
    const trialsEndingSoon = trialing.filter((s) => s.trialEndsAt && s.trialEndsAt <= soon).length;

    sendSuccess(
      res,
      {
        firms: firmCount,
        payingFirms: paying.length,
        trials: trialing.length,
        trialsEndingSoon,
        churnedFirms: churned.length,
        mrr,
        arr: mrr * 12,
        arpa: paying.length ? Math.round(mrr / paying.length) : 0,
        // Of everyone who ever paid, the share that has since left.
        churnRate:
          paying.length + churned.length
            ? +((churned.length / (paying.length + churned.length)) * 100).toFixed(1)
            : 0,
        seatsSold,
        seatsUsed,
        atRisk: subscriptions
          .filter((s) => s.status === "past_due")
          .reduce((total, s) => total + s.mrr, 0),
        byPlan,
      },
      "Firm metrics retrieved"
    );
  } catch (err) {
    sendError(res, "Failed to retrieve firm metrics", 500, (err as Error).message);
  }
};

/** GET /admin/firms/:id */
export const getFirm = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    if (!Types.ObjectId.isValid(String(req.params.id))) {
      sendNotFound(res, "Firm not found");
      return;
    }

    const firm = await Firm.findById(req.params.id);
    if (!firm) {
      sendNotFound(res, "Firm not found");
      return;
    }

    const subscription = await Subscription.findOne({ firmId: firm._id });
    const summary = await summarise(firm, subscription);

    sendSuccess(
      res,
      {
        ...summary,
        address: firm.address ?? null,
        registrationNumber: firm.registrationNumber ?? null,
        aiAutonomy: firm.aiAutonomy,
        subscription: subscription
          ? {
              startedAt: subscription.startedAt,
              cancelledAt: subscription.cancelledAt ?? null,
              suspendedAt: subscription.suspendedAt ?? null,
            }
          : null,
      },
      "Firm retrieved"
    );
  } catch (err) {
    sendError(res, "Failed to retrieve firm", 500, (err as Error).message);
  }
};

/** GET /admin/firms/:id/people — who is at the firm and how they are doing. */
export const getFirmPeople = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    if (!Types.ObjectId.isValid(String(req.params.id))) {
      sendNotFound(res, "Firm not found");
      return;
    }

    const members = await FirmMember.find({ firmId: req.params.id })
      .select("name email role isActive lastLogin emailVerifiedAt barStatus createdAt")
      .sort({ role: 1, name: 1 })
      .lean();

    sendSuccess(
      res,
      members.map((member) => ({
        id: member._id.toString(),
        name: member.name,
        email: member.email,
        role: member.role,
        // Someone who has never signed in has not taken up their seat, which is
        // a different thing from being switched off.
        status: !member.isActive ? "suspended" : member.lastLogin ? "active" : "invited",
        lastLoginAt: member.lastLogin ?? null,
        emailVerified: Boolean(member.emailVerifiedAt),
        barStatus: member.barStatus,
        joinedAt: member.createdAt,
      })),
      "Firm members retrieved"
    );
  } catch (err) {
    sendError(res, "Failed to retrieve firm members", 500, (err as Error).message);
  }
};

/** The catalogue itself, so the dashboard never hard-codes a price. */
export const getPlans = (_req: AdminRequest, res: Response): void => {
  sendSuccess(
    res,
    Object.entries(PLAN_CATALOGUE).map(([plan, details]) => ({ plan, ...details })),
    "Plans retrieved"
  );
};

export const FIRM_STATUSES = SUBSCRIPTION_STATUSES;
export { isFirmPlan };
