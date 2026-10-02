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
  /** Naira per month. */
  priceNgn: number;
  /** Naira per year. Two months free against twelve at the monthly rate. */
  annualNgn: number;
  /**
   * True when the price is a floor rather than a figure — Enterprise is
   * negotiated upwards from here, and the agreed amount lives on that firm's
   * subscription.
   */
  from?: boolean;
  /** Seats included. Enterprise starts here and is agreed upwards. */
  seats: number;
}

export const PLAN_CATALOGUE: Record<FirmPlan, PlanDetails> = {
  starter: { label: "Starter", priceNgn: 25_000, annualNgn: 250_000, seats: 2 },
  practice: { label: "Practice", priceNgn: 50_000, annualNgn: 500_000, seats: 5 },
  firm: { label: "Firm", priceNgn: 75_000, annualNgn: 750_000, seats: 10 },
  enterprise: {
    label: "Enterprise",
    priceNgn: 200_000,
    annualNgn: 2_000_000,
    from: true,
    seats: 11,
  },
};

export const isFirmPlan = (value: unknown): value is FirmPlan =>
  typeof value === "string" && (FIRM_PLANS as readonly string[]).includes(value);

/** The next plan up, or null at the top. Drives every "ready to upgrade" hint. */
export const nextPlanUp = (plan: FirmPlan): FirmPlan | null => {
  const index = FIRM_PLANS.indexOf(plan);
  return index >= 0 && index < FIRM_PLANS.length - 1 ? FIRM_PLANS[index + 1] : null;
};

/**
 * The old starter | professional | enterprise values, kept only so existing
 * rows can be read and migrated. Nothing writes these any more:
 * Firm.subscriptionPlan now holds a FirmPlan.
 *
 * "professional" was lossy — Practice and Firm both folded into it — so a
 * migration cannot recover which one a firm was on. It maps to practice, the
 * cheaper of the two, because over-charging a firm on a guess is worse than
 * under-charging one.
 */
export type LegacyFirmPlan = "starter" | "professional" | "enterprise";

export const planFromLegacyValue = (value: string): FirmPlan => {
  if (value === "starter") return "starter";
  if (value === "enterprise") return "enterprise";
  if (value === "professional") return "practice";
  return isFirmPlan(value) ? value : "starter";
};

/** What a firm on this plan pays each month, before any negotiated figure. */
export const listPriceFor = (plan: FirmPlan): number => PLAN_CATALOGUE[plan].priceNgn;

/** What a firm on this plan pays for a year — ten months' worth, not twelve. */
export const annualPriceFor = (plan: FirmPlan): number => PLAN_CATALOGUE[plan].annualNgn;

export const seatsFor = (plan: FirmPlan): number => PLAN_CATALOGUE[plan].seats;
