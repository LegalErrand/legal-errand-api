import { Response } from "express";
import { Types } from "mongoose";
import { AdminRequest } from "../../types";
import { Firm, Invoice, Payment, Subscription, PAYING_STATUSES } from "../../models/firm";
import { PLAN_CATALOGUE, FirmPlan } from "../../config/plans";
import { sendSuccess, sendNotFound, sendError } from "../../utils/response";

/** GET /admin/firms/:id/invoices — the billing tab. */
export const getFirmInvoices = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    if (!Types.ObjectId.isValid(id)) {
      sendNotFound(res, "Firm not found");
      return;
    }

    const invoices = await Invoice.find({ firmId: id }).sort({ issuedAt: -1 }).limit(24).lean();
    const attempts = await Payment.find({ invoiceId: { $in: invoices.map((i) => i._id) } })
      .sort({ attempt: 1 })
      .lean();

    const byInvoice = new Map<string, typeof attempts>();
    for (const attempt of attempts) {
      const key = attempt.invoiceId.toString();
      byInvoice.set(key, [...(byInvoice.get(key) ?? []), attempt]);
    }

    sendSuccess(
      res,
      invoices.map((invoice) => {
        const tries = byInvoice.get(invoice._id.toString()) ?? [];
        return {
          id: invoice._id.toString(),
          number: invoice.number,
          amount: invoice.amount,
          status: invoice.status,
          plan: invoice.plan,
          periodStart: invoice.periodStart,
          periodEnd: invoice.periodEnd,
          issuedAt: invoice.issuedAt,
          paidAt: invoice.paidAt ?? null,
          // How many goes it took, and why the last one failed if it did.
          attempts: tries.length,
          lastFailureReason:
            [...tries].reverse().find((t) => t.status === "failed")?.failureReason ?? null,
        };
      }),
      "Invoices retrieved"
    );
  } catch (err) {
    sendError(res, "Failed to retrieve invoices", 500, (err as Error).message);
  }
};

/**
 * GET /admin/firms/revenue
 *
 * What is coming in, and what moved this month.
 *
 * The monthly series is **collected and invoiced**, taken from invoices, not a
 * history of MRR. We do not snapshot MRR, so there is no honest way to draw what
 * it was in March; `mrrHistoryRetained: false` says so rather than letting a
 * chart imply otherwise. Collections are the better number anyway — they are
 * money that actually arrived.
 */
export const getRevenue = async (_req: AdminRequest, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const [subscriptions, invoices] = await Promise.all([
      Subscription.find().select("plan status mrr startedAt cancelledAt").lean(),
      Invoice.find({ issuedAt: { $gte: start } })
        .select("amount status issuedAt paidAt")
        .lean(),
    ]);

    const paying = subscriptions.filter((s) => PAYING_STATUSES.includes(s.status));
    const mrr = paying.reduce((total, s) => total + s.mrr, 0);

    // Twelve buckets, oldest first, keyed by year-month so December to January
    // cannot collide.
    const series: { month: string; label: string; invoiced: number; collected: number }[] = [];
    for (let back = 11; back >= 0; back--) {
      const at = new Date(now.getFullYear(), now.getMonth() - back, 1);
      series.push({
        month: `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`,
        label: at.toLocaleDateString("en-GB", { month: "short" }),
        invoiced: 0,
        collected: 0,
      });
    }
    const index = new Map(series.map((bucket, i) => [bucket.month, i]));
    for (const invoice of invoices) {
      const at = new Date(invoice.issuedAt);
      const key = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
      const bucket = index.get(key);
      if (bucket === undefined) continue;
      series[bucket].invoiced += invoice.amount;
      if (invoice.status === "paid") series[bucket].collected += invoice.amount;
    }

    // What moved this month. New business and cancellations come from the
    // subscriptions themselves; upgrades and downgrades are not derivable
    // without a history of plan changes, which the audit log only has from the
    // day it was introduced — so they are reported as what we can see.
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const startedThisMonth = subscriptions.filter(
      (s) => s.startedAt >= monthStart && PAYING_STATUSES.includes(s.status)
    );
    const cancelledThisMonth = subscriptions.filter(
      (s) => s.cancelledAt && s.cancelledAt >= monthStart
    );

    const failed = await Invoice.find({ status: "failed" }).select("firmId amount").lean();
    const atRiskFirms = await Firm.find({ _id: { $in: failed.map((i) => i.firmId) } })
      .select("name")
      .lean();
    const nameFor = new Map(atRiskFirms.map((f) => [f._id.toString(), f.name]));

    sendSuccess(
      res,
      {
        mrr,
        arr: mrr * 12,
        arpa: paying.length ? Math.round(mrr / paying.length) : 0,
        payingFirms: paying.length,
        mrrHistoryRetained: false,
        series,
        movements: {
          newFirms: startedThisMonth.reduce((total, s) => total + s.mrr, 0),
          cancellations: -cancelledThisMonth.reduce((total, s) => total + s.mrr, 0),
          upgradesAndDowngrades: null,
        },
        byPlan: (Object.keys(PLAN_CATALOGUE) as FirmPlan[]).map((plan) => {
          const onPlan = paying.filter((s) => s.plan === plan);
          return {
            plan,
            label: PLAN_CATALOGUE[plan].label,
            firms: onPlan.length,
            mrr: onPlan.reduce((total, s) => total + s.mrr, 0),
          };
        }),
        atRisk: {
          amount: failed.reduce((total, i) => total + i.amount, 0),
          invoices: failed.length,
          firms: [...new Set(failed.map((i) => i.firmId.toString()))].map((id) => ({
            id,
            name: nameFor.get(id) ?? null,
          })),
        },
      },
      "Revenue retrieved"
    );
  } catch (err) {
    sendError(res, "Failed to retrieve revenue", 500, (err as Error).message);
  }
};
