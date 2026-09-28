import { Schema, model, Document, Types } from "mongoose";

/**
 * What a firm was billed, and whether it arrived.
 *
 * - open   — issued, not yet due or not yet attempted.
 * - paid   — money received.
 * - failed — every attempt was declined. The firm's subscription goes past_due
 *            alongside this; the invoice stays failed until a retry succeeds.
 * - void   — issued in error and withdrawn. Never deleted, so the sequence of
 *            invoice numbers stays unbroken.
 */
export const INVOICE_STATUSES = ["open", "paid", "failed", "void"] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface IInvoice extends Document {
  firmId: Types.ObjectId;
  /** Human-facing reference, e.g. LE-20481. Unique and never reused. */
  number: string;
  /** Naira. Whole numbers — we do not bill kobo. */
  amount: number;
  status: InvoiceStatus;
  /** What the firm was on when this was raised, kept even if they move later. */
  plan: string;
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceSchema = new Schema<IInvoice>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    number: { type: String, required: true, unique: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: INVOICE_STATUSES, required: true, default: "open", index: true },
    plan: { type: String, required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    issuedAt: { type: Date, required: true, default: Date.now },
    paidAt: { type: Date },
  },
  { timestamps: true }
);

// "This firm's invoices, newest first" is the billing tab's only query.
invoiceSchema.index({ firmId: 1, issuedAt: -1 });
// "What was collected this month" drives the revenue screen.
invoiceSchema.index({ status: 1, issuedAt: -1 });

export const Invoice = model<IInvoice>("Invoice", invoiceSchema);
