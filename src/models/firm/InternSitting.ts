import { Schema, model, Document, Types } from "mongoose";

/**
 * An intern saying "I'll attend" a court sitting (LE-046).
 *
 * The sitting itself lives in `CalendarEvent` — this records one intern's
 * attendance against it, and the logbook line it created, so attendance cannot
 * be claimed twice and always has a logbook entry behind it.
 */
export interface IInternSitting extends Document {
  firmId: Types.ObjectId;
  ownerId: Types.ObjectId;
  placementId: Types.ObjectId;
  eventId: Types.ObjectId;
  /** Snapshots, so the logbook still reads correctly if the event is edited. */
  title: string;
  /** YYYY-MM-DD */
  date: string;
  court?: string;
  matterName?: string;
  logbookEntryId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const InternSittingSchema = new Schema<IInternSitting>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "FirmMember", required: true, index: true },
    placementId: { type: Schema.Types.ObjectId, ref: "InternPlacement", required: true },
    eventId: { type: Schema.Types.ObjectId, ref: "CalendarEvent", required: true },
    title: { type: String, required: true },
    date: { type: String, required: true },
    court: { type: String },
    matterName: { type: String },
    logbookEntryId: { type: Schema.Types.ObjectId, ref: "InternLogbookEntry" },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// One attendance per intern per sitting.
InternSittingSchema.index({ firmId: 1, ownerId: 1, eventId: 1 }, { unique: true });

export const InternSitting = model<IInternSitting>("InternSitting", InternSittingSchema);
