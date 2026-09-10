import { Schema, model, Document, Types } from "mongoose";

export type ClientStatus = "lead" | "active" | "at_risk" | "archived";

export interface IClient extends Document {
  firmId: Types.ObjectId;
  name: string;
  type: "Individual" | "Company";
  status: ClientStatus;
  practiceArea: string;
  phone?: string;
  email?: string;
  whatsappNumber?: string;
  mattersCount: number;
  lawyerId?: Types.ObjectId;
  lawyerName?: string;
  lastContactText: string;
  urgencyNote?: string;
  intakeDetails?: {
    channel: "whatsapp" | "web" | "referral";
    receivedAt: Date;
    aiConfidence: number;
    conflictCheckPassed: boolean;
    conflictCheckNote?: string;
    extractedFacts: Array<{ key: string; value: string }>;
    documents: Array<{
      name: string;
      source: string;
      status: "verified" | "extracted" | "pending" | "missing";
    }>;
  };
  createdAt: Date;
  updatedAt: Date;
}

const ClientSchema = new Schema<IClient>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ["Individual", "Company"], default: "Individual" },
    status: {
      type: String,
      enum: ["lead", "active", "at_risk", "archived"],
      default: "lead",
      index: true,
    },
    practiceArea: { type: String, required: true, default: "General" },
    phone: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true },
    whatsappNumber: { type: String, trim: true },
    mattersCount: { type: Number, default: 0 },
    lawyerId: { type: Schema.Types.ObjectId, ref: "FirmMember" },
    lawyerName: { type: String },
    lastContactText: { type: String, default: "Today" },
    urgencyNote: { type: String },
    intakeDetails: {
      channel: { type: String, enum: ["whatsapp", "web", "referral"], default: "whatsapp" },
      receivedAt: { type: Date, default: Date.now },
      aiConfidence: { type: Number, default: 95 },
      conflictCheckPassed: { type: Boolean, default: true },
      conflictCheckNote: { type: String },
      extractedFacts: [
        {
          key: { type: String, required: true },
          value: { type: String, required: true },
        },
      ],
      documents: [
        {
          name: { type: String, required: true },
          source: { type: String, default: "WhatsApp upload" },
          status: {
            type: String,
            enum: ["verified", "extracted", "pending", "missing"],
            default: "verified",
          },
        },
      ],
    },
  },
  { timestamps: true }
);

export const Client = model<IClient>("Client", ClientSchema);
