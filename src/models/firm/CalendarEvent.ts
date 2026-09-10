import { Schema, model, Document, Types } from "mongoose";

export type CalendarEventType = "court" | "filing" | "meeting" | "internal" | "ai_generated";

export interface ICalendarEvent extends Document {
  firmId: Types.ObjectId;
  title: string;
  date: string; // YYYY-MM-DD
  time?: string;
  type: CalendarEventType;
  matterId?: Types.ObjectId;
  matter?: string;
  lawyerId?: Types.ObjectId;
  lawyer?: string;
  location?: string;
  relatedTasks: Array<{ label: string; done: boolean }>;
  documents: string[];
  createdAt: Date;
  updatedAt: Date;
}

const CalendarEventSchema = new Schema<ICalendarEvent>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    title: { type: String, required: true, trim: true },
    date: { type: String, required: true, index: true },
    time: { type: String },
    type: {
      type: String,
      enum: ["court", "filing", "meeting", "internal", "ai_generated"],
      default: "court",
      index: true,
    },
    matterId: { type: Schema.Types.ObjectId, ref: "Matter" },
    matter: { type: String },
    lawyerId: { type: Schema.Types.ObjectId, ref: "FirmMember" },
    lawyer: { type: String },
    location: { type: String },
    relatedTasks: [
      {
        label: { type: String, required: true },
        done: { type: Boolean, default: false },
      },
    ],
    documents: { type: [String], default: [] },
  },
  { timestamps: true }
);

export const CalendarEvent = model<ICalendarEvent>("CalendarEvent", CalendarEventSchema);
