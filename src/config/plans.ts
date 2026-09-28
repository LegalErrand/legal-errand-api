/**
 * What a firm can be on, and what it costs.
 *
 * Money is Nigerian naira throughout — every plan is priced in naira and every
 * payment is collected in naira, so there is no currency to carry around.
 *
 * Enterprise has no list price: it is negotiated per firm, and the agreed figure
 * lives on that firm's subscription rather than here.
 */

export const FIRM_PLANS = ["starter", "practice", "firm", "enterprise"] as const;

export type FirmPlan = (typeof FIRM_PLANS)[number];

export interface PlanDetails {
  /** How the plan is written on a screen or an invoice. */
  label: string;
  /** Naira per month, or null when the price is negotiated. */
  priceNgn: number | null;
  /** Seats included. Enterprise starts here and is agreed upwards. */
  seats: number;
}

export const PLAN_CATALOGUE: Record<FirmPlan, PlanDetails> = {
  starter: { label: "Starter", priceNgn: 25_000, seats: 2 },
  practice: { label: "Practice", priceNgn: 50_000, seats: 5 },
  firm: { label: "Firm", priceNgn: 75_000, seats: 10 },
  enterprise: { label: "Enterprise", priceNgn: null, seats: 12 },
};

export const isFirmPlan = (value: unknown): value is FirmPlan =>
  typeof value === "string" && (FIRM_PLANS as readonly string[]).includes(value);

/** The next plan up, or null at the top. Drives every "ready to upgrade" hint. */
export const nextPlanUp = (plan: FirmPlan): FirmPlan | null => {
  const index = FIRM_PLANS.indexOf(plan);
  return index >= 0 && index < FIRM_PLANS.length - 1 ? FIRM_PLANS[index + 1] : null;
};

/**
 * Firm.subscriptionPlan predates this catalogue and still uses
 * starter | professional | enterprise. The firm app reads it, so it has to keep
 * answering until that app moves across — see the note on the field itself.
 *
 * Practice and Firm both fold into "professional", which is lossy. That is
 * acceptable only because the legacy field gates coarse features, never price:
 * the real plan is always the subscription's.
 */
export type LegacyFirmPlan = "starter" | "professional" | "enterprise";

export const legacyPlanFor = (plan: FirmPlan): LegacyFirmPlan => {
  if (plan === "starter") return "starter";
  if (plan === "enterprise") return "enterprise";
  return "professional";
};

/** What a firm on this plan pays each month, before any negotiated figure. */
export const listPriceFor = (plan: FirmPlan): number => PLAN_CATALOGUE[plan].priceNgn ?? 0;

export const seatsFor = (plan: FirmPlan): number => PLAN_CATALOGUE[plan].seats;
