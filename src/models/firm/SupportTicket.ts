import { Schema, model, Document, Types } from "mongoose";

export const TICKET_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_STATUSES = ["open", "in_progress", "waiting_on_firm", "resolved"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Which team owns it. Free-form enough to change without a migration. */
export const TICKET_TEAMS = [
  "support",
  "billing",
  "product",
  "sales",
  "onboarding",
  "ai_quality",
] as const;
export type TicketTeam = (typeof TICKET_TEAMS)[number];

export interface ISupportTicket extends Document {
  /** Human-facing reference, e.g. T-1042. */
  reference: string;
  firmId: Types.ObjectId;
  /** Who at the firm raised it, when we know. */
  memberId?: Types.ObjectId;
  subject: string;
  priority: TicketPriority;
  status: TicketStatus;
  team: TicketTeam;
  openedAt: Date;
  /** When someone from our side first answered — the median of these is a KPI. */
  firstRepliedAt?: Date;
  resolvedAt?: Date;
  resolvedByAdminId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const supportTicketSchema = new Schema<ISupportTicket>(
  {
    reference: { type: String, required: true, unique: true, trim: true },
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: "FirmMember" },
    subject: { type: String, required: true, trim: true },
    priority: { type: String, enum: TICKET_PRIORITIES, required: true, default: "normal" },
    status: { type: String, enum: TICKET_STATUSES, required: true, default: "open", index: true },
    team: { type: String, enum: TICKET_TEAMS, required: true, default: "support" },
    openedAt: { type: Date, required: true, default: Date.now },
    firstRepliedAt: { type: Date },
    resolvedAt: { type: Date },
    resolvedByAdminId: { type: Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true }
);

// "What is still open, worst first" is the support queue.
supportTicketSchema.index({ status: 1, priority: 1, openedAt: -1 });

export const SupportTicket = model<ISupportTicket>("SupportTicket", supportTicketSchema);

/** Anything a person still has to deal with. */
export const UNRESOLVED_TICKET_STATUSES: TicketStatus[] = [
  "open",
  "in_progress",
  "waiting_on_firm",
];
