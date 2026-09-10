import { Schema, model, Document, Types } from "mongoose";

export type MatterStage = "Intake" | "Filing" | "Discovery" | "Hearing" | "Review" | "Closed";

export type MatterHealth =
  | "on_track"
  | "at_risk"
  | "blocked"
  | "awaiting_client"
  | "client_unresponsive";

export interface IMatter extends Document {
  firmId: Types.ObjectId;
  name: string; // Georgia serif
  suitNumber?: string;
  clientId: Types.ObjectId;
  clientName: string;
  type: string; // e.g., "Civil litigation", "Corporate", "Probate", "Family"
  stage: MatterStage;
  stageProgress: number; // 0-100
  nextDeadline?: string;
  lawyerId?: Types.ObjectId;
  lawyerName: string;
  health: MatterHealth;
  healthNote?: string;
  urgentItems: string[];
  nextActions: Array<{ label: string; date: string }>;
  aiSummary?: string;
  recentActivity: Array<{
    time: string;
    actor: string;
    isAI?: boolean;
    description: string;
    docName?: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const MatterSchema = new Schema<IMatter>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    name: { type: String, required: true, trim: true },
    suitNumber: { type: String, trim: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    clientName: { type: String, required: true },
    type: { type: String, required: true, default: "Civil litigation" },
    stage: {
      type: String,
      enum: ["Intake", "Filing", "Discovery", "Hearing", "Review", "Closed"],
      default: "Intake",
      index: true,
    },
    stageProgress: { type: Number, default: 10 },
    nextDeadline: { type: String },
    lawyerId: { type: Schema.Types.ObjectId, ref: "FirmMember" },
    lawyerName: { type: String, default: "Unassigned" },
    health: {
      type: String,
      enum: ["on_track", "at_risk", "blocked", "awaiting_client", "client_unresponsive"],
      default: "on_track",
    },
    healthNote: { type: String },
    urgentItems: { type: [String], default: [] },
    nextActions: [
      {
        label: { type: String, required: true },
        date: { type: String, required: true },
      },
    ],
    aiSummary: { type: String },
    recentActivity: [
      {
        time: { type: String, required: true },
        actor: { type: String, required: true },
        isAI: { type: Boolean, default: false },
        description: { type: String, required: true },
        docName: { type: String },
      },
    ],
  },
  { timestamps: true }
);

export const Matter = model<IMatter>("Matter", MatterSchema);
