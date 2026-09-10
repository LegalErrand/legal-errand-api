import { Schema, model, Document } from "mongoose";

export interface IFirm extends Document {
  name: string;
  jurisdiction: string;
  courtFilingPortalId?: string;
  contactEmail: string;
  address?: string;
  subscriptionPlan: "starter" | "professional" | "enterprise";
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
    contactEmail: { type: String, required: true, lowercase: true, trim: true },
    address: { type: String, trim: true },
    subscriptionPlan: {
      type: String,
      enum: ["starter", "professional", "enterprise"],
      default: "enterprise",
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
  { timestamps: true }
);

export const Firm = model<IFirm>("Firm", FirmSchema);
