import { Schema, model, Document } from "mongoose";

/**
 * A firm sign-up that has not produced a Firm yet.
 *
 * The first screens of the sign-up flow collect an email and a password before
 * the person has told us anything about their firm, so there is nothing to hang
 * a FirmMember off — it requires a firmId. This collection holds that
 * half-finished state until the firm details step creates the real records, at
 * which point the document is deleted.
 *
 * Abandoned sign-ups delete themselves via the TTL index on `expiresAt`, so an
 * email address that never completes does not block a later, genuine attempt.
 */
export interface IFirmSignup extends Document {
  email: string;
  /** bcrypt hash — never the plaintext, and never selected by default. */
  password: string;
  /** sha256 of the six-digit code. Cleared once the email is verified. */
  codeHash?: string;
  codeExpiresAt?: Date;
  /** Wrong codes so far. Reset whenever a new code is issued. */
  codeAttempts: number;
  /** Drives the resend cooldown the sign-up screen shows. */
  lastCodeSentAt?: Date;
  verifiedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const FirmSignupSchema = new Schema<IFirmSignup>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    password: { type: String, required: true, select: false },
    codeHash: { type: String, select: false },
    codeExpiresAt: { type: Date },
    codeAttempts: { type: Number, default: 0 },
    lastCodeSentAt: { type: Date },
    verifiedAt: { type: Date },
    expiresAt: { type: Date, required: true, default: () => new Date(Date.now() + DAY_MS) },
  },
  { timestamps: true }
);

// Mongo drops the document once expiresAt passes, so unfinished sign-ups do not
// accumulate and do not hold an email address hostage.
FirmSignupSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const FirmSignup = model<IFirmSignup>("FirmSignup", FirmSignupSchema);
