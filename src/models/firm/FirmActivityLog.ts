import { Schema, model, Document, Types } from "mongoose";

/**
 * What people at a firm did, and when.
 *
 * ── The boundary ──────────────────────────────────────────────────────────────
 * This is metadata and nothing else. A row may say that a document was exported
 * or that a matter moved to discovery; it may never say which client the matter
 * is for, what the document said, or anything a firm told us in confidence.
 * Matters and documents appear as reference numbers — M-1042, D-3180.
 *
 * That is a promise to every firm on LegalErrand, not an implementation detail.
 * `summary` is the only free-text field here, and whatever writes to it is
 * responsible for keeping it clean; prefer recordActivity(), which is built to.
 */
export const ACTIVITY_TYPES = [
  "signin",
  "matter",
  "document",
  "ai",
  "research",
  "client",
  "calendar",
  "billing",
  "settings",
  "security",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface IFirmActivityLog extends Document {
  firmId: Types.ObjectId;
  memberId: Types.ObjectId;
  type: ActivityType;
  /** Metadata only. See the boundary note above. */
  summary: string;
  /** A reference number the summary points at, when there is one. */
  reference?: string;
  /** Roughly where from — a city, never a street. */
  city?: string;
  /** First two octets only. Enough to spot a pattern, not enough to locate. */
  ipPrefix?: string;
  /** Set on a failed sign-in, so an attack on a firm's accounts stands out. */
  suspicious: boolean;
  at: Date;
  createdAt: Date;
  updatedAt: Date;
}

const firmActivityLogSchema = new Schema<IFirmActivityLog>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: "FirmMember", required: true, index: true },
    type: { type: String, enum: ACTIVITY_TYPES, required: true, index: true },
    summary: { type: String, required: true, trim: true },
    reference: { type: String, trim: true },
    city: { type: String, trim: true },
    ipPrefix: { type: String, trim: true },
    suspicious: { type: Boolean, required: true, default: false },
    at: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: true }
);

// The activity screens read one firm's rows newest-first, or everyone's.
firmActivityLogSchema.index({ firmId: 1, at: -1 });
firmActivityLogSchema.index({ at: -1, type: 1 });

export const FirmActivityLog = model<IFirmActivityLog>("FirmActivityLog", firmActivityLogSchema);
