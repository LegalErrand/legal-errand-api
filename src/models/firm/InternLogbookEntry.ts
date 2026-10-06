import { Schema, model, Document, Types } from "mongoose";

export type LogbookSource = "manual" | "court_sitting";

/**
 * One line of an intern's logbook (LE-046).
 *
 * A logbook belongs to one intern: every query filters by `firmId` and
 * `ownerId`, so there is no route that reads or writes another intern's book.
 * Only the supervisor countersigns, and a countersigned line is frozen.
 */
export interface IInternLogbookEntry extends Document {
  firmId: Types.ObjectId;
  ownerId: Types.ObjectId;
  placementId: Types.ObjectId;
  /** YYYY-MM-DD */
  date: string;
  /** 0–24. Quarter hours are allowed. */
  hours: number;
  activity: string;
  matterId?: Types.ObjectId;
  matterName?: string;
  source: LogbookSource;
  /** The calendar event, when this line came from attending a sitting. */
  sittingEventId?: Types.ObjectId;
  countersignedById?: Types.ObjectId;
  countersignedByName?: string;
  countersignedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const InternLogbookEntrySchema = new Schema<IInternLogbookEntry>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "FirmMember", required: true, index: true },
    placementId: { type: Schema.Types.ObjectId, ref: "InternPlacement", required: true },
    date: { type: String, required: true, index: true },
    hours: { type: Number, required: true, min: 0, max: 24 },
    activity: { type: String, required: true, trim: true },
    matterId: { type: Schema.Types.ObjectId, ref: "Matter" },
    matterName: { type: String },
    source: { type: String, enum: ["manual", "court_sitting"], default: "manual" },
    sittingEventId: { type: Schema.Types.ObjectId, ref: "CalendarEvent" },
    countersignedById: { type: Schema.Types.ObjectId, ref: "FirmMember" },
    countersignedByName: { type: String },
    countersignedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Every read is "this intern's logbook, newest day first".
InternLogbookEntrySchema.index({ firmId: 1, ownerId: 1, date: -1 });

export const InternLogbookEntry = model<IInternLogbookEntry>(
  "InternLogbookEntry",
  InternLogbookEntrySchema
);
