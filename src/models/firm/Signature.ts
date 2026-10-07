import { Schema, model, Document, Types } from "mongoose";

/**
 * LE-028 — signatures.
 *
 * Three separate things live here:
 *  • SavedSignature     — a signature saved to one member's own account. Visible
 *                         to nobody else: every read is scoped to firmId *and*
 *                         ownerId, and there is no "whose signatures" parameter.
 *  • AppliedSignature   — a signature placed on a document. Immutable once the
 *                         document is signed (`locked`); edits are refused 409.
 *  • SignatureRequest   — a dashed line left for someone else, plus the request.
 */

export const SIGNATURE_KINDS = ["drawn", "typed", "uploaded"] as const;
export type SignatureKind = (typeof SIGNATURE_KINDS)[number];

// ─── Saved signatures ────────────────────────────────────────────────────────

export interface ISavedSignature extends Document {
  firmId: Types.ObjectId;
  /** The member whose signature this is. Never exposed to anyone else. */
  ownerId: Types.ObjectId;
  kind: SignatureKind;
  /** PNG data URL of the signature image. */
  dataUrl: string;
  name: string;
  capacity?: string;
  /** Font family, for typed signatures. */
  fontFamily?: string;
  createdAt: Date;
  updatedAt: Date;
}

const savedSignatureSchema = new Schema<ISavedSignature>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "FirmMember", required: true, index: true },
    kind: { type: String, enum: SIGNATURE_KINDS, required: true },
    dataUrl: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    capacity: { type: String, trim: true },
    fontFamily: { type: String, trim: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

savedSignatureSchema.index({ firmId: 1, ownerId: 1, createdAt: -1 });

export const SavedSignature = model<ISavedSignature>("SavedSignature", savedSignatureSchema);

// ─── Applied signatures ──────────────────────────────────────────────────────

export interface IAppliedSignature extends Document {
  firmId: Types.ObjectId;
  documentId: Types.ObjectId;
  signedBy: Types.ObjectId;
  kind: SignatureKind;
  dataUrl: string;
  name: string;
  capacity?: string;
  /** `YYYY-MM-DD`, when "Add today's date" was ticked. */
  dateSigned?: string;
  /**
   * Once the document is signed the mark on it cannot change. Writes against a
   * locked row are refused with 409 rather than silently ignored.
   */
  locked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const appliedSignatureSchema = new Schema<IAppliedSignature>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    documentId: { type: Schema.Types.ObjectId, ref: "FirmDocument", required: true, index: true },
    signedBy: { type: Schema.Types.ObjectId, ref: "FirmMember", required: true },
    kind: { type: String, enum: SIGNATURE_KINDS, required: true },
    dataUrl: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    capacity: { type: String, trim: true },
    dateSigned: { type: String, trim: true },
    locked: { type: Boolean, required: true, default: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

export const AppliedSignature = model<IAppliedSignature>(
  "AppliedSignature",
  appliedSignatureSchema
);

// ─── Signature requests ──────────────────────────────────────────────────────

export const SIGNATURE_REQUEST_STATUSES = ["pending", "signed", "declined"] as const;
export type SignatureRequestStatus = (typeof SIGNATURE_REQUEST_STATUSES)[number];

export interface ISignatureRequest extends Document {
  firmId: Types.ObjectId;
  documentId: Types.ObjectId;
  name: string;
  capacity: string;
  email: string;
  status: SignatureRequestStatus;
  requestedBy: Types.ObjectId;
  requestedAt: Date;

  // ── The one-time link ────────────────────────────────────────────────────
  /**
   * The id carried in the link's token. The token alone cannot authorise
   * anything: it is only accepted while this id still matches a row that is
   * `pending` and unexpired, which is what makes the link single-use and
   * lets one link be revoked without touching the signing secret.
   */
  tokenId: string;
  expiresAt: Date;

  // ── The audit certificate (who, when, from where, and of what) ───────────
  signedAt?: Date;
  declinedAt?: Date;
  declineReason?: string;
  /** The signer's address as the request arrived. Evidence, so never edited. */
  signerIp?: string;
  signerUserAgent?: string;
  /**
   * SHA-256 of the document's content at the moment of signing. This is what
   * makes the certificate mean something: it ties the signature to the exact
   * text that was on screen, so a later edit is detectable.
   */
  documentHash?: string;
  /** The title as it read when signed, since a document may be renamed. */
  documentTitleAtSigning?: string;
  /** Short human reference, quotable in correspondence. */
  certificateRef?: string;

  createdAt: Date;
  updatedAt: Date;
}

const signatureRequestSchema = new Schema<ISignatureRequest>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    documentId: { type: Schema.Types.ObjectId, ref: "FirmDocument", required: true, index: true },
    name: { type: String, required: true, trim: true },
    capacity: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    status: {
      type: String,
      enum: SIGNATURE_REQUEST_STATUSES,
      required: true,
      default: "pending",
    },
    requestedBy: { type: Schema.Types.ObjectId, ref: "FirmMember", required: true },
    requestedAt: { type: Date, required: true, default: Date.now },

    tokenId: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true },

    signedAt: { type: Date },
    declinedAt: { type: Date },
    declineReason: { type: String, trim: true },
    signerIp: { type: String, trim: true },
    signerUserAgent: { type: String, trim: true },
    documentHash: { type: String, trim: true },
    documentTitleAtSigning: { type: String, trim: true },
    certificateRef: { type: String, trim: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

/** How long a signing link stays usable. */
export const SIGNATURE_LINK_TTL_SECONDS = 14 * 24 * 60 * 60;

export const SignatureRequest = model<ISignatureRequest>(
  "SignatureRequest",
  signatureRequestSchema
);
