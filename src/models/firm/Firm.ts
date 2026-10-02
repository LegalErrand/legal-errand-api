import { Schema, model, Document } from "mongoose";
import { FIRM_PLANS, FirmPlan } from "../../config/plans";

export interface IFirm extends Document {
  name: string;
  jurisdiction: string;
  courtFilingPortalId?: string;
  /** CAC/company registration number, so invoices carry the registered name. */
  registrationNumber?: string;
  contactEmail: string;
  address?: string;
  /**
   * URL-safe handle for the firm's public pages — the public intake form is
   * reached by it, so a prospective client never needs an id or a login.
   * Derived from the name when absent.
   */
  slug?: string;
  /**
   * Where the firm is, structured. `jurisdiction` says which court they file in,
   * which is a different question and a free-text one — it cannot be filtered or
   * grouped, and the firm admin needs to do both.
   */
  country: string;
  /** State, province, nation or region — whatever that country calls its own. */
  state?: string;
  /**
   * The firm's plan, in the catalogue's own names. The Subscription still
   * carries the authoritative price and seat count; this is the coarse value
   * screens read.
   */
  subscriptionPlan: FirmPlan;
  feeEarnerCapacity: number;
  aiAutonomy: {
    intakeExtraction: "auto" | "review" | "partner";
    documentDrafting: "auto" | "review" | "partner";
    clientMessaging: "auto" | "review" | "partner";
    billingInvoicing: "auto" | "review" | "partner";
  };
  notificationTiers: {
    criticalChannels: string[];
    attentionChannels: string[];
    completedChannels: string[];
  };
  createdAt: Date;
  updatedAt: Date;
}

const FirmSchema = new Schema<IFirm>(
  {
    name: { type: String, required: true, trim: true },
    jurisdiction: { type: String, required: true, default: "Nigeria (Lagos State High Court)" },
    courtFilingPortalId: { type: String, trim: true },
    registrationNumber: { type: String, trim: true },
    contactEmail: { type: String, required: true, lowercase: true, trim: true },
    address: { type: String, trim: true },
    // Sparse: firms created before this field existed have no slug, and a
    // unique index would otherwise collide on null for all of them.
    slug: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
    country: { type: String, trim: true, default: "Nigeria", index: true },
    state: { type: String, trim: true, index: true },
    subscriptionPlan: {
      type: String,
      enum: FIRM_PLANS,
      default: "starter",
    },
    feeEarnerCapacity: { type: Number, default: 10 },
    aiAutonomy: {
      intakeExtraction: { type: String, enum: ["auto", "review", "partner"], default: "auto" },
      documentDrafting: { type: String, enum: ["auto", "review", "partner"], default: "partner" },
      clientMessaging: { type: String, enum: ["auto", "review", "partner"], default: "review" },
      billingInvoicing: { type: String, enum: ["auto", "review", "partner"], default: "partner" },
    },
    notificationTiers: {
      criticalChannels: { type: [String], default: ["Push", "SMS", "WhatsApp"] },
      attentionChannels: { type: [String], default: ["Push", "In-app"] },
      completedChannels: { type: [String], default: ["In-app"] },
    },
  },
  {
    timestamps: true,
    // The client reads `id`; without virtuals in toJSON only `_id` is sent,
    // which breaks every detail link and lookup that keys on id.
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

export const Firm = model<IFirm>("Firm", FirmSchema);
