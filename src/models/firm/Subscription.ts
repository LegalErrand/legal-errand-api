import { Schema, model, Document, Types } from "mongoose";
import { FIRM_PLANS, FirmPlan } from "../../config/plans";

/**
 * Where a firm stands with us commercially.
 *
 * - trialing  — using it, paying nothing, with an end date.
 * - active    — paying.
 * - past_due  — a renewal was declined. Still working; we are chasing the card.
 * - churned   — they cancelled and left.
 * - suspended — we turned them off. Only an admin does this, and only on purpose.
 *
 * "past_due" is the only one a firm reaches on its own without meaning to, which
 * is why it reads as "Payment failed" wherever it is shown to a person.
 */
export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "churned",
  "suspended",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface ISubscription extends Document {
  firmId: Types.ObjectId;
  plan: FirmPlan;
  status: SubscriptionStatus;
  /** Seats the firm is paying for. Usually the plan's, but Enterprise is agreed. */
  seats: number;
  /**
   * Naira per month. Held here rather than looked up from the catalogue, so a
   * price change tomorrow cannot silently rewrite what a firm agreed to today.
   * Zero while trialing or churned.
   */
  mrr: number;
  trialEndsAt?: Date;
  renewsAt?: Date;
  startedAt: Date;
  cancelledAt?: Date;
  suspendedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionSchema = new Schema<ISubscription>(
  {
    // One subscription per firm: a firm is on exactly one plan at a time.
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, unique: true, index: true },
    plan: { type: String, enum: FIRM_PLANS, required: true },
    status: { type: String, enum: SUBSCRIPTION_STATUSES, required: true, index: true },
    seats: { type: Number, required: true, min: 1 },
    mrr: { type: Number, required: true, min: 0, default: 0 },
    trialEndsAt: { type: Date },
    renewsAt: { type: Date },
    startedAt: { type: Date, required: true, default: Date.now },
    cancelledAt: { type: Date },
    suspendedAt: { type: Date },
  },
  { timestamps: true }
);

// The revenue screens ask "everyone paying, by plan" constantly.
subscriptionSchema.index({ status: 1, plan: 1 });
// And "whose trial runs out in the next few days" drives the decision queue.
subscriptionSchema.index({ status: 1, trialEndsAt: 1 });

export const Subscription = model<ISubscription>("Subscription", subscriptionSchema);

/** Statuses that mean money is expected from this firm every month. */
export const PAYING_STATUSES: SubscriptionStatus[] = ["active", "past_due"];
