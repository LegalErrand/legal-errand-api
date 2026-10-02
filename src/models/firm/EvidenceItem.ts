import { Schema, model, Document, Types } from "mongoose";

/**
 * LE-032 — one piece of evidence.
 *
 * Evidence is what comes *in* on a matter: from the client, the other side, a
 * court or a third party. It is kept entirely apart from FirmDocument — nothing
 * the firm writes is filed here. Moving an item across to Documents is a
 * recorded act (see the evidence controller's `moveEvidence`).
 */

export const EVIDENCE_ORIGINS = ["client_upload", "intake", "other_side", "requested"] as const;
export type EvidenceOrigin = (typeof EVIDENCE_ORIGINS)[number];

export const EVIDENCE_STATUSES = ["filed", "in_review", "not_indexed"] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const EVIDENCE_CATEGORIES = [
  "exhibits",
  "correspondence",
  "witness",
  "court_papers",
] as const;
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

export interface IEvidenceItem extends Document {
  firmId: Types.ObjectId;
  /** Absent while the item sits in "Just attached — not filed yet". */
  matterId?: Types.ObjectId;
  matterName?: string;
  name: string;
  category?: EvidenceCategory;
  /**
   * The free-text origin line under the name, e.g. "Client upload · 23 files".
   * The enum the "Came from" column renders is `cameFrom`.
   */
  origin?: string;
  cameFrom: EvidenceOrigin;
  status: EvidenceStatus;
  riskScore?: number;
  /** False until the virus scan clears — nothing can be opened before then. */
  scanned: boolean;
  /** True once the AI named, dated or categorised it. */
  aiTagged: boolean;
  uploadedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const evidenceItemSchema = new Schema<IEvidenceItem>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    matterId: { type: Schema.Types.ObjectId, ref: "Matter", index: true },
    matterName: { type: String, trim: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: EVIDENCE_CATEGORIES },
    origin: { type: String, trim: true },
    cameFrom: { type: String, enum: EVIDENCE_ORIGINS, required: true, default: "client_upload" },
    status: {
      type: String,
      enum: EVIDENCE_STATUSES,
      required: true,
      default: "not_indexed",
      index: true,
    },
    riskScore: { type: Number, min: 0, max: 100 },
    scanned: { type: Boolean, required: true, default: false },
    aiTagged: { type: Boolean, required: true, default: false },
    uploadedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// The evidence screen reads one firm's items newest-first, filtered by matter.
evidenceItemSchema.index({ firmId: 1, uploadedAt: -1 });

export const EvidenceItem = model<IEvidenceItem>("EvidenceItem", evidenceItemSchema);
