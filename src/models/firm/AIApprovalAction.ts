import { Schema, model, Document, Types } from "mongoose";

export interface IAIApprovalAction extends Document {
  firmId: Types.ObjectId;
  description: string;
  type: "whatsapp_reply" | "task_assign" | "invoice" | "filing_draft" | "conflict_flag";
  clientId?: Types.ObjectId;
  clientName?: string;
  matterId?: Types.ObjectId;
  matterName?: string;
  draft?: string;
  confidence: number;
  status: "pending" | "approved" | "rejected" | "edited";
  actionPayload?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const AIApprovalActionSchema = new Schema<IAIApprovalAction>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    description: { type: String, required: true },
    type: {
      type: String,
      enum: ["whatsapp_reply", "task_assign", "invoice", "filing_draft", "conflict_flag"],
      required: true,
      index: true,
    },
    clientId: { type: Schema.Types.ObjectId, ref: "Client" },
    clientName: { type: String },
    matterId: { type: Schema.Types.ObjectId, ref: "Matter" },
    matterName: { type: String },
    draft: { type: String },
    confidence: { type: Number, default: 90 },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "edited"],
      default: "pending",
      index: true,
    },
    actionPayload: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

export const AIApprovalAction = model<IAIApprovalAction>(
  "AIApprovalAction",
  AIApprovalActionSchema
);
