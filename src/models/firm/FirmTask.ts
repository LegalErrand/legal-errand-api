import { Schema, model, Document, Types } from "mongoose";

export type FirmTaskStatus = "not_started" | "in_progress" | "done" | "overdue" | "escalated";

export interface IFirmTask extends Document {
  firmId: Types.ObjectId;
  title: string;
  matterId: Types.ObjectId;
  matterName: string;
  dueDate: string; // e.g. "Due Sept 9" or "Overdue 4 days"
  assigneeId?: Types.ObjectId;
  assignee: string;
  assigneeInitials: string;
  priority: "high" | "medium" | "low";
  status: FirmTaskStatus;
  aiCreated: boolean;
  blocks?: string;
  waitingOn?: string;
  aiPlan?: string;
  escalatedTo?: string;
  subtasksTotal?: number;
  subtasksDone?: number;
  createdAt: Date;
  updatedAt: Date;
}

const FirmTaskSchema = new Schema<IFirmTask>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    title: { type: String, required: true, trim: true },
    matterId: { type: Schema.Types.ObjectId, ref: "Matter", required: true, index: true },
    matterName: { type: String, required: true },
    dueDate: { type: String, required: true },
    assigneeId: { type: Schema.Types.ObjectId, ref: "FirmMember" },
    assignee: { type: String, required: true },
    assigneeInitials: { type: String, required: true },
    priority: { type: String, enum: ["high", "medium", "low"], default: "medium" },
    status: {
      type: String,
      enum: ["not_started", "in_progress", "done", "overdue", "escalated"],
      default: "not_started",
      index: true,
    },
    aiCreated: { type: Boolean, default: false },
    blocks: { type: String },
    waitingOn: { type: String },
    aiPlan: { type: String },
    escalatedTo: { type: String },
    subtasksTotal: { type: Number, default: 0 },
    subtasksDone: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const FirmTask = model<IFirmTask>("FirmTask", FirmTaskSchema);
