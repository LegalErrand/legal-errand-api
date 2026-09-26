import { Schema, model, Document, Types } from "mongoose";
import { FirmRole } from "./FirmMember";

/**
 * An invitation to join a firm at a given role.
 *
 * Single use and short lived: the token is the only thing that proves the
 * invitation, so it is stored as a sha256 and the plaintext exists only in the
 * email. Expired and accepted invitations are kept for a while rather than
 * deleted, because "this invitation has expired" is a screen the recipient has
 * to be able to reach — a missing record would render as a broken link instead.
 */
export interface IFirmInvitation extends Document {
  firmId: Types.ObjectId;
  email: string;
  role: FirmRole;
  invitedBy: Types.ObjectId;
  /** sha256 of the token in the invitation link. */
  tokenHash: string;
  expiresAt: Date;
  acceptedAt?: Date;
  revokedAt?: Date;
  /** When the record itself is swept, well after it stops being usable. */
  purgeAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const INVITE_TTL_MS = 7 * DAY_MS;
const PURGE_AFTER_MS = 30 * DAY_MS;

const FirmInvitationSchema = new Schema<IFirmInvitation>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    role: {
      type: String,
      enum: [
        "managing_partner",
        "partner",
        "senior_associate",
        "associate",
        "junior_associate",
        "paralegal",
        "admin",
      ],
      required: true,
    },
    invitedBy: { type: Schema.Types.ObjectId, ref: "FirmMember", required: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true, default: () => new Date(Date.now() + INVITE_TTL_MS) },
    acceptedAt: { type: Date },
    revokedAt: { type: Date },
    purgeAt: { type: Date, required: true, default: () => new Date(Date.now() + PURGE_AFTER_MS) },
  },
  { timestamps: true }
);

FirmInvitationSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const FirmInvitation = model<IFirmInvitation>("FirmInvitation", FirmInvitationSchema);
