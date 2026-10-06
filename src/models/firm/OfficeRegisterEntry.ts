import { Schema, model, Document, Types } from "mongoose";

/**
 * LE-011 — the office manager's registers.
 *
 * The firm admin dashboard is seven tabs of *registers*: correspondence,
 * visitors, leave, certificates, vendors, assets, risks, decisions and so on.
 * Structurally they are the same thing — a dated row with a person against it,
 * a state, and an audit trail of who touched it when — so they share one model
 * discriminated by `kind` rather than twenty near-identical collections. That
 * is what lets the acceptance criterion ("every register supports add, edit,
 * mark done and delete, with who and when") hold for all of them at once
 * instead of only the two or three someone had time to write.
 *
 * Nothing here references matter content. A row may name a matter so the admin
 * knows it exists and what it bills, but never its documents, notes, messages
 * or AI activity — that is privileged and is not the office manager's to read.
 */

export const OFFICE_REGISTER_KINDS = [
  // Front desk
  "correspondence",
  "visitor",
  "message",
  "typing",
  "registry_run",
  "supply",
  "room_booking",
  "attendance",
  // Finance
  "running_cost",
  "expense_claim",
  "petty_cash",
  "statutory_deadline",
  // HR
  "leave",
  "certificate",
  "appraisal",
  "hiring",
  // Operations
  "vendor",
  "incident",
  "asset",
  // Technology
  "system",
  "licence",
  "support_ticket",
  "security_item",
  "backup",
  // Strategy
  "objective",
  "risk",
  "decision",
] as const;

export type OfficeRegisterKind = (typeof OFFICE_REGISTER_KINDS)[number];

export const OFFICE_REGISTER_STATUSES = [
  "open",
  "in_progress",
  "blocked",
  "done",
  "exploring",
  "with_partners",
] as const;

export type OfficeRegisterStatus = (typeof OFFICE_REGISTER_STATUSES)[number];

/** Who did what, and when. Stamped by the controller, never by the client. */
export interface IOfficeRegisterStamp {
  memberId?: Types.ObjectId;
  name: string;
  at: Date;
}

export interface IOfficeRegisterEntry extends Document {
  firmId: Types.ObjectId;
  kind: OfficeRegisterKind;

  /** The row as the office manager reads it, e.g. "FIRS VAT return". */
  title: string;
  /** One line of context. Never matter content. */
  detail?: string;
  status: OfficeRegisterStatus;

  /** The person this row is about — a staff member, a visitor, a claimant. */
  personName?: string;
  personId?: Types.ObjectId;
  /** Who covers while they are away (leave register). */
  coverName?: string;
  /** Vendor, supplier or system owner. */
  vendorName?: string;

  /** Money, in whole naira, matching ClientInvoice's convention. */
  amountNaira?: number;
  /** Seats or licences bought and used (technology register). */
  quantityUsed?: number;
  quantityTotal?: number;
  /** 0–100, for objectives. */
  progressPct?: number;

  startOn?: Date;
  endOn?: Date;
  /** The date that drives the 30/14/3-day alerts (LE-005). */
  dueOn?: Date;

  location?: string;
  reference?: string;
  /** Free-text reason, e.g. a decision's "Supervision data supports it". */
  reason?: string;
  /** A matter may be *named* here. Its contents are never stored or returned. */
  matterName?: string;

  createdBy: IOfficeRegisterStamp;
  updatedBy?: IOfficeRegisterStamp;
  completedBy?: IOfficeRegisterStamp;

  createdAt: Date;
  updatedAt: Date;
}

const StampSchema = new Schema<IOfficeRegisterStamp>(
  {
    memberId: { type: Schema.Types.ObjectId, ref: "FirmMember" },
    name: { type: String, required: true, trim: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const OfficeRegisterEntrySchema = new Schema<IOfficeRegisterEntry>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    kind: { type: String, enum: OFFICE_REGISTER_KINDS, required: true, index: true },

    title: { type: String, required: true, trim: true },
    detail: { type: String, trim: true },
    status: { type: String, enum: OFFICE_REGISTER_STATUSES, default: "open", index: true },

    personName: { type: String, trim: true },
    personId: { type: Schema.Types.ObjectId, ref: "FirmMember" },
    coverName: { type: String, trim: true },
    vendorName: { type: String, trim: true },

    amountNaira: { type: Number },
    quantityUsed: { type: Number },
    quantityTotal: { type: Number },
    progressPct: { type: Number, min: 0, max: 100 },

    startOn: { type: Date },
    endOn: { type: Date },
    dueOn: { type: Date, index: true },

    location: { type: String, trim: true },
    reference: { type: String, trim: true },
    reason: { type: String, trim: true },
    matterName: { type: String, trim: true },

    createdBy: { type: StampSchema, required: true },
    updatedBy: { type: StampSchema },
    completedBy: { type: StampSchema },
  },
  { timestamps: true }
);

// Every read is "this firm's rows of this kind, by date" — index that shape.
OfficeRegisterEntrySchema.index({ firmId: 1, kind: 1, dueOn: 1 });

export const OfficeRegisterEntry = model<IOfficeRegisterEntry>(
  "OfficeRegisterEntry",
  OfficeRegisterEntrySchema
);
