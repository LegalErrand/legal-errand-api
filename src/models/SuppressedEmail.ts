import { Schema, model, Document } from "mongoose";

/**
 * Addresses we must stop emailing, as reported by SES.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * SES judges a sender by how much mail they send to addresses that bounce and
 * to people who mark it as spam. Sending repeatedly to a dead address is the
 * fastest way to lose sending access, and losing sending access means nobody
 * can sign up or log in, because every sign-in needs an emailed code. So this
 * list is not housekeeping: it protects the one channel the product's auth
 * depends on.
 *
 * ── What does and does not land here ────────────────────────────────────────
 * Only two things suppress an address:
 *   • a Permanent bounce  — the mailbox does not exist and never will
 *   • a Complaint         — the recipient marked our mail as spam
 *
 * Transient bounces (a full mailbox, a greylisting, a timeout) are deliberately
 * NOT suppressed. They are temporary by definition, and suppressing them would
 * lock a real user out of their own account over a mailbox that was briefly
 * full.
 *
 * ── Removal ─────────────────────────────────────────────────────────────────
 * A row here blocks mail indefinitely, which is correct for a dead mailbox and
 * wrong for a mistake, so removal is a deliberate admin act rather than a
 * timer. There is no TTL index on purpose.
 */

export const SUPPRESSION_REASONS = ["bounce", "complaint"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export interface ISuppressedEmail extends Document {
  /** Always lowercased, so a lookup cannot miss on casing. */
  email: string;
  reason: SuppressionReason;
  /** SES's own classification, e.g. "Permanent" / "General". Kept for triage. */
  bounceType?: string;
  bounceSubType?: string;
  /** The receiving mail server's explanation, when it gave one. */
  diagnostic?: string;
  /** The SES message that triggered this, for tracing a specific send. */
  sesMessageId?: string;
  at: Date;
  createdAt: Date;
  updatedAt: Date;
}

const suppressedEmailSchema = new Schema<ISuppressedEmail>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    reason: { type: String, enum: SUPPRESSION_REASONS, required: true },
    bounceType: { type: String, trim: true },
    bounceSubType: { type: String, trim: true },
    diagnostic: { type: String, trim: true },
    sesMessageId: { type: String, trim: true },
    at: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

export const SuppressedEmail = model<ISuppressedEmail>("SuppressedEmail", suppressedEmailSchema);

/**
 * True when we must not email this address.
 *
 * Fails OPEN: if the lookup itself errors, the caller is told the address is
 * fine and the mail goes. A database wobble should not silently stop a login
 * code, and SES will simply report the bounce again if we were wrong.
 */
export const isSuppressed = async (email: string): Promise<boolean> => {
  try {
    const row = await SuppressedEmail.exists({ email: email.toLowerCase().trim() });
    return Boolean(row);
  } catch {
    return false;
  }
};
