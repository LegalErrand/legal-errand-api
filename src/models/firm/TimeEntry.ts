import { Schema, model, Document, Types } from "mongoose";

export type TimeSource = "ai_detected" | "from_calendar" | "manual";

export interface IFirmTimeEntry extends Document {
  firmId: Types.ObjectId;
  activity: string;
  matterId?: Types.ObjectId;
  matterName: string;
  duration: number; // hours
  originalDuration?: number;
  billable: boolean;
  source: TimeSource;
  approved: boolean;
  rate?: number;
  feeEarnerId?: Types.ObjectId;
  feeEarnerName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const FirmTimeEntrySchema = new Schema<IFirmTimeEntry>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    activity: { type: String, required: true, trim: true },
    matterId: { type: Schema.Types.ObjectId, ref: "Matter", index: true },
    matterName: { type: String, required: true },
    duration: { type: Number, required: true, default: 0.5 },
    originalDuration: { type: Number },
    billable: { type: Boolean, default: true, index: true },
    source: {
      type: String,
      enum: ["ai_detected", "from_calendar", "manual"],
      default: "manual",
    },
    approved: { type: Boolean, default: false, index: true },
    rate: { type: Number, default: 50000 },
    feeEarnerId: { type: Schema.Types.ObjectId, ref: "FirmMember" },
    feeEarnerName: { type: String },
  },
  { timestamps: true }
);

export const FirmTimeEntry = model<IFirmTimeEntry>("FirmTimeEntry", FirmTimeEntrySchema);
