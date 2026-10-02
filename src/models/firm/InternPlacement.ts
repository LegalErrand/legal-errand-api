import { Schema, model, Document, Types } from "mongoose";

export type PlacementType = "nysc" | "law_school" | "university" | "chambers";

export const PLACEMENT_TYPES: PlacementType[] = ["nysc", "law_school", "university", "chambers"];

/**
 * An intern's placement (LE-046).
 *
 * Read-only to the intern: the type, dates and hours target are set by a
 * partner in LE-042, so no intern-facing endpoint writes to this document. One
 * live placement per intern per firm.
 */
export interface IInternPlacement extends Document {
  firmId: Types.ObjectId;
  /** The intern this placement belongs to. */
  internId: Types.ObjectId;
  type: PlacementType;
  /** "Litigation", "Corporate commercial" — the team the intern sits with. */
  practiceArea?: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  /** Hours the placement must total to be signed off. */
  hoursTarget: number;
  /** Hours the intern is expected to log each week. */
  weeklyHoursTarget: number;
  /** Court sittings the intern is expected to attend. */
  sittingsTarget: number;
  supervisorId: Types.ObjectId;
  /** Snapshot, so a later rename cannot rewrite a countersigned logbook. */
  supervisorName: string;
  supervisorRole?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const InternPlacementSchema = new Schema<IInternPlacement>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    internId: { type: Schema.Types.ObjectId, ref: "FirmMember", required: true, index: true },
    type: { type: String, enum: PLACEMENT_TYPES, required: true, default: "nysc" },
    practiceArea: { type: String },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    hoursTarget: { type: Number, required: true, default: 480 },
    weeklyHoursTarget: { type: Number, default: 40 },
    sittingsTarget: { type: Number, default: 6 },
    supervisorId: { type: Schema.Types.ObjectId, ref: "FirmMember", required: true },
    supervisorName: { type: String, required: true },
    supervisorRole: { type: String },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    // The client reads `id`; without virtuals in toJSON only `_id` is sent.
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

InternPlacementSchema.index({ firmId: 1, internId: 1, isActive: 1 });

export const InternPlacement = model<IInternPlacement>("InternPlacement", InternPlacementSchema);
