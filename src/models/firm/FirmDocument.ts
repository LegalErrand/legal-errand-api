import { Schema, model, Document, Types } from "mongoose";

export type FirmDocStatus =
  | "filed"
  | "in_review"
  | "awaiting_approval"
  | "unsorted"
  | "template"
  | "draft";

export interface IFirmDocument extends Document {
  firmId: Types.ObjectId;
  name: string;
  type: string; // e.g. "Filed document", "Contract", "Retainer", "Bundle", "Template"
  matterId?: Types.ObjectId;
  matterName?: string;
  status: FirmDocStatus;
  riskScore?: number; // 0-100
  aiFindings?: Array<{
    severity: "amber" | "red" | "green";
    title: string;
    description: string;
    suggestedClause?: string;
    resolved: boolean;
  }>;
  s3Key?: string;
  s3Url?: string;
  pages?: number;
  modifiedText: string;
  aiTags: string[];
  source?: "ai_draft" | "client_upload" | "template" | "filed";
  content?: string;
  createdAt: Date;
  updatedAt: Date;
}

const FirmDocumentSchema = new Schema<IFirmDocument>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, required: true, default: "Contract" },
    matterId: { type: Schema.Types.ObjectId, ref: "Matter", index: true },
    matterName: { type: String },
    status: {
      type: String,
      enum: ["filed", "in_review", "awaiting_approval", "unsorted", "template", "draft"],
      default: "draft",
      index: true,
    },
    riskScore: { type: Number },
    aiFindings: [
      {
        severity: { type: String, enum: ["amber", "red", "green"], required: true },
        title: { type: String, required: true },
        description: { type: String, required: true },
        suggestedClause: { type: String },
        resolved: { type: Boolean, default: false },
      },
    ],
    s3Key: { type: String },
    s3Url: { type: String },
    pages: { type: Number, default: 1 },
    modifiedText: { type: String, default: "Just now" },
    aiTags: { type: [String], default: [] },
    source: {
      type: String,
      enum: ["ai_draft", "client_upload", "template", "filed"],
      default: "ai_draft",
    },
    content: { type: String },
  },
  { timestamps: true }
);

export const FirmDocument = model<IFirmDocument>("FirmDocument", FirmDocumentSchema);
