import { Schema, model, Document, Types } from "mongoose";

/**
 * What a firm bills its own client (LE-023).
 *
 * Distinct from `Invoice`, which is what LegalErrand bills the *firm* for its
 * subscription. Conflating the two would put a firm's subscription charge in
 * front of its clients, so they stay separate models with separate names.
 *
 * Money is in naira throughout, held in whole naira rather than kobo because
 * every figure the firm sets, sees and is paid is in naira.
 */

export type ClientInvoiceStatus = "draft" | "sent" | "part_paid" | "paid" | "overdue";

/** LE-023 — Nigerian VAT. */
export const VAT_RATE = 0.075;

export interface IClientInvoiceLine {
  _id?: Types.ObjectId;
  /** What was done, as the client should read it. */
  activity: string;
  /** Hours, in 0.1 units per LE-023. */
  hours: number;
  rateNaira: number;
  amountNaira: number;
  /** The time entries this line was built from, so a figure can be traced back. */
  timeEntryIds?: Types.ObjectId[];
}

export interface IClientInvoicePayment {
  _id?: Types.ObjectId;
  amountNaira: number;
  /** Paystack's reference, so a payment can be reconciled against them. */
  reference?: string;
  method?: string;
  paidAt: Date;
}

export interface IClientInvoice extends Document {
  firmId: Types.ObjectId;
  clientId: Types.ObjectId;
  clientName: string;
  matterId?: Types.ObjectId;
  matterName?: string;
  /** Human reference shown to the client, e.g. INV-000142. */
  reference: string;
  lines: IClientInvoiceLine[];
  subtotalNaira: number;
  /** 7.5% of subtotal less discount, stored rather than recomputed so a
   *  historic invoice keeps the rate it was issued under. */
  vatNaira: number;
  discountNaira: number;
  totalNaira: number;
  paidNaira: number;
  status: ClientInvoiceStatus;
  issuedOn?: Date;
  dueOn?: Date;
  /** LE-023: a write-off needs a reason, and only a partner may do it. */
  writtenOffNaira?: number;
  writeOffReason?: string;
  writtenOffByName?: string;
  /** The Paystack link sent to the client. */
  payLink?: string;
  payments: IClientInvoicePayment[];
  createdAt: Date;
  updatedAt: Date;
}

const LineSchema = new Schema<IClientInvoiceLine>(
  {
    activity: { type: String, required: true },
    hours: { type: Number, required: true },
    rateNaira: { type: Number, required: true },
    amountNaira: { type: Number, required: true },
    timeEntryIds: [{ type: Schema.Types.ObjectId, ref: "FirmTimeEntry" }],
  },
  { _id: true }
);

const PaymentSchema = new Schema<IClientInvoicePayment>(
  {
    amountNaira: { type: Number, required: true },
    reference: { type: String, trim: true },
    method: { type: String, trim: true },
    paidAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const ClientInvoiceSchema = new Schema<IClientInvoice>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    clientName: { type: String, required: true },
    matterId: { type: Schema.Types.ObjectId, ref: "Matter", index: true },
    matterName: { type: String },
    reference: { type: String, required: true, trim: true },
    lines: { type: [LineSchema], default: [] },
    subtotalNaira: { type: Number, default: 0 },
    vatNaira: { type: Number, default: 0 },
    discountNaira: { type: Number, default: 0 },
    totalNaira: { type: Number, default: 0 },
    paidNaira: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["draft", "sent", "part_paid", "paid", "overdue"],
      default: "draft",
      index: true,
    },
    issuedOn: { type: Date },
    dueOn: { type: Date },
    writtenOffNaira: { type: Number },
    writeOffReason: { type: String, trim: true },
    writtenOffByName: { type: String, trim: true },
    payLink: { type: String, trim: true },
    payments: { type: [PaymentSchema], default: [] },
  },
  { timestamps: true }
);

// A reference is unique within a firm, not globally — two firms numbering from
// INV-000001 is normal and must not collide.
ClientInvoiceSchema.index({ firmId: 1, reference: 1 }, { unique: true });

/**
 * Totals, derived in one place so the figure on the invoice, in the portal and
 * in the firm's analytics cannot disagree.
 */
export function recalculateInvoice(invoice: IClientInvoice): void {
  invoice.subtotalNaira = invoice.lines.reduce((sum, l) => sum + l.amountNaira, 0);
  const taxable = Math.max(0, invoice.subtotalNaira - (invoice.discountNaira ?? 0));
  invoice.vatNaira = Math.round(taxable * VAT_RATE);
  invoice.totalNaira = Math.max(0, taxable + invoice.vatNaira - (invoice.writtenOffNaira ?? 0));
  invoice.paidNaira = invoice.payments.reduce((sum, p) => sum + p.amountNaira, 0);

  // A draft has not been sent, so it is not owed and cannot be overdue.
  if (invoice.status === "draft") return;

  // Settled covers both "paid in full" and "written off to nothing" — an
  // invoice with nothing left owing is not still part paid.
  if (invoice.paidNaira >= invoice.totalNaira) {
    invoice.status = "paid";
  } else if (invoice.paidNaira > 0) {
    invoice.status = "part_paid";
  } else if (invoice.dueOn && invoice.dueOn.getTime() < Date.now()) {
    invoice.status = "overdue";
  } else {
    invoice.status = "sent";
  }
}

export const ClientInvoice = model<IClientInvoice>("ClientInvoice", ClientInvoiceSchema);
