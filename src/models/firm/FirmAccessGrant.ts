import { Schema, model, Document, Types } from "mongoose";

/**
 * Permission for one named LegalErrand admin to look inside one firm's
 * workspace, for a limited time, because that firm's owner said yes.
 *
 * ── Why this exists as a record rather than a flag ──────────────────────────
 * Support sometimes has to see what a firm sees. The alternative to asking is
 * a standing back door, which is the thing a law firm would least forgive: the
 * matters in there are privileged. So access is requested, granted by the
 * firm's own managing partner, time-boxed, revocable, and every use of it is
 * written down.
 *
 * ── What a grant does and does not permit ───────────────────────────────────
 * An approved, unexpired grant lets that one admin mint a read-only firm
 * session. It is read-only in the token itself and enforced in middleware, so
 * an admin holding one cannot change, delete or send anything. It never
 * extends to another admin, another firm, or past `expiresAt`.
 */

export const ACCESS_GRANT_STATUSES = ["pending", "approved", "declined", "revoked"] as const;
export type AccessGrantStatus = (typeof ACCESS_GRANT_STATUSES)[number];

/** How long approved access lasts. The owner said yes to a visit, not a key. */
export const ACCESS_GRANT_TTL_MS = 24 * 60 * 60 * 1000;

export interface IFirmAccessGrant extends Document {
  firmId: Types.ObjectId;
  /** The one admin this grant belongs to. Never shared with another. */
  adminId: Types.ObjectId;
  adminName: string;
  adminEmail: string;
  /** Why they asked, in their own words, shown to the owner verbatim. */
  reason?: string;
  status: AccessGrantStatus;

  /**
   * sha256 of the token in the owner's email link. The link is the credential:
   * the owner holds no admin account, and asking them to log in to approve
   * would send most requests to a dead end.
   */
  decisionTokenHash: string;
  /** The link stops working after this, whether or not it was used. */
  decisionExpiresAt: Date;

  requestedAt: Date;
  decidedAt?: Date;
  /** Which member approved or declined it, for the audit trail. */
  decidedByMemberId?: Types.ObjectId;
  decidedByName?: string;
  /** Set on approval. Access ends here. */
  expiresAt?: Date;
  revokedAt?: Date;

  /** Every read-only session minted against this grant. */
  uses: Array<{ at: Date; ip?: string }>;

  createdAt: Date;
  updatedAt: Date;
}

const firmAccessGrantSchema = new Schema<IFirmAccessGrant>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    adminId: { type: Schema.Types.ObjectId, ref: "Admin", required: true, index: true },
    adminName: { type: String, required: true, trim: true },
    adminEmail: { type: String, required: true, lowercase: true, trim: true },
    reason: { type: String, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: ACCESS_GRANT_STATUSES,
      required: true,
      default: "pending",
      index: true,
    },
    decisionTokenHash: { type: String, required: true, index: true, select: false },
    decisionExpiresAt: { type: Date, required: true },
    requestedAt: { type: Date, required: true, default: Date.now },
    decidedAt: { type: Date },
    decidedByMemberId: { type: Schema.Types.ObjectId, ref: "FirmMember" },
    decidedByName: { type: String, trim: true },
    expiresAt: { type: Date },
    revokedAt: { type: Date },
    uses: {
      type: [{ _id: false, at: { type: Date, required: true }, ip: { type: String } }],
      default: [],
    },
  },
  { timestamps: true }
);

// The question "may this admin look at this firm right now" is asked on every
// token mint, so it gets an index rather than a scan.
firmAccessGrantSchema.index({ firmId: 1, adminId: 1, status: 1 });

export const FirmAccessGrant = model<IFirmAccessGrant>("FirmAccessGrant", firmAccessGrantSchema);

/** True when this admin may currently mint a read-only session for this firm. */
export const isGrantUsable = (grant: IFirmAccessGrant | null): boolean =>
  !!grant &&
  grant.status === "approved" &&
  !grant.revokedAt &&
  !!grant.expiresAt &&
  grant.expiresAt.getTime() > Date.now();
