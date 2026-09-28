import { Schema, model, Document, Types } from "mongoose";

/**
 * One attempt to collect one invoice.
 *
 * An invoice can have several: a card is declined, we retry, it goes through.
 * Keeping every attempt rather than a single status on the invoice is what lets
 * anyone answer "how many times did this fail before it worked?".
 *
 * There is no live payment integration in this repo yet. Rows are written when
 * an admin retries a payment, and the provider fields are shaped for Paystack
 * so that wiring it up later does not mean a migration.
 */
export const PAYMENT_STATUSES = ["succeeded", "failed", "pending"] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_PROVIDERS = ["paystack", "flutterwave", "manual"] as const;

export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export interface IPayment extends Document {
  invoiceId: Types.ObjectId;
  firmId: Types.ObjectId;
  provider: PaymentProvider;
  /** The provider's own reference, once there is a provider to give us one. */
  providerRef?: string;
  /** How they paid, as a person would say it: "Card", "Transfer", "USSD". */
  method?: string;
  amount: number;
  status: PaymentStatus;
  /** 1 for the first go, 2 for the first retry, and so on. */
  attempt: number;
  /** The provider's reason, verbatim, when it declined. */
  failureReason?: string;
  /** Set when an admin pressed retry rather than the schedule running. */
  triggeredByAdminId?: Types.ObjectId;
  attemptedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice", required: true, index: true },
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    provider: { type: String, enum: PAYMENT_PROVIDERS, required: true, default: "paystack" },
    providerRef: { type: String, trim: true },
    method: { type: String, trim: true },
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: PAYMENT_STATUSES, required: true, index: true },
    attempt: { type: Number, required: true, min: 1, default: 1 },
    failureReason: { type: String, trim: true },
    triggeredByAdminId: { type: Schema.Types.ObjectId, ref: "Admin" },
    attemptedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

paymentSchema.index({ invoiceId: 1, attempt: 1 });

export const Payment = model<IPayment>("Payment", paymentSchema);
