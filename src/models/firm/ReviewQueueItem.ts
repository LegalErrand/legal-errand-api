import { Schema, model, Document, Types } from "mongoose";

export type ReviewType = "filing" | "client_advice" | "money" | "conflict_waiver" | "ai_generated";

export interface IReviewQueueItem extends Document {
  firmId: Types.ObjectId;
  type: ReviewType;
  title: string;
  matterId?: Types.ObjectId;
  matter: string;
  description: string;
  preparedBy: string;
  reviewedBy?: string;
  nextStep: string;
  chain: string[];
  deadline?: string;
  skippedStep?: string;
  amount?: string;
  status: "pending" | "approved" | "changes_requested" | "rejected";
  redlines?: {
    additions: string[];
    deletions: string[];
    summary?: string;
  };
  feedback?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewQueueItemSchema = new Schema<IReviewQueueItem>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    type: {
      type: String,
      enum: ["filing", "client_advice", "money", "conflict_waiver", "ai_generated"],
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    matterId: { type: Schema.Types.ObjectId, ref: "Matter", index: true },
    matter: { type: String, required: true },
    description: { type: String, required: true },
    preparedBy: { type: String, required: true },
    reviewedBy: { type: String },
    nextStep: { type: String, required: true, default: "Partner" },
    chain: { type: [String], default: ["Junior", "Senior", "Partner"] },
    deadline: { type: String },
    skippedStep: { type: String },
    amount: { type: String },
    status: {
      type: String,
      enum: ["pending", "approved", "changes_requested", "rejected"],
      default: "pending",
      index: true,
    },
    redlines: {
      additions: { type: [String], default: [] },
      deletions: { type: [String], default: [] },
      summary: { type: String },
    },
    feedback: { type: String },
  },
  { timestamps: true }
);

export const ReviewQueueItem = model<IReviewQueueItem>("ReviewQueueItem", ReviewQueueItemSchema);
