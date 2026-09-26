import { Schema, model, Document, Types } from "mongoose";
import bcrypt from "bcryptjs";
import { env } from "../../config/env";

export type FirmRole =
  | "managing_partner"
  | "partner"
  | "senior_associate"
  | "associate"
  | "junior_associate"
  | "paralegal"
  | "admin";

export type SupervisionLevel = "light" | "standard" | "close";

export interface IFirmMember extends Document {
  firmId: Types.ObjectId;
  name: string;
  email: string;
  initials: string;
  role: FirmRole;
  avatar?: string;
  mattersCount: number;
  openMattersText?: string;
  utilisation: number; // percentage (0-100)
  onTimeRate: number; // percentage (0-100)
  reworkRoundsAvg: number;
  waitingOnReviewCount: number;
  waitingAgeText?: string;
  supervision: SupervisionLevel;
  isActive: boolean;
  /** Selected only when explicitly requested — never returned by default. */
  password?: string;
  lastLogin?: Date;
  /** Set once the member has proved they control the address. */
  emailVerifiedAt?: Date;
  /** sha256 of the single-use reset token. Cleared the moment it is spent. */
  passwordResetTokenHash?: string;
  passwordResetExpiresAt?: Date;
  /**
   * When the password last changed. Tokens issued before this are rejected, so
   * a reset ends every other session.
   */
  passwordChangedAt?: Date;
  /**
   * Standing at the bar. Drives what may leave the firm with this person's
   * name on it — signing filings, advising a client, approving AI output —
   * rather than whether they can sign in at all.
   */
  barNumber?: string;
  barYearOfCall?: number;
  barJurisdiction?: string;
  barCertificateUrl?: string;
  barStatus: "unverified" | "pending" | "verified" | "rejected" | "skipped" | "not_applicable";
  barSubmittedAt?: Date;
  barVerifiedAt?: Date;
  /** Consecutive wrong passwords. Cleared by a correct one. */
  failedLoginAttempts: number;
  /** Set once the attempts run out; login refuses until it passes. */
  lockedUntil?: Date;
  /** sha256 of the passwordless sign-in link, when one has been requested. */
  magicLinkTokenHash?: string;
  magicLinkExpiresAt?: Date;
  /**
   * Browsers this member has chosen to trust. While one is presented and
   * unexpired the one-time code is skipped, which is the only thing "trust
   * this device" buys — it never skips the password.
   */
  trustedDevices?: Array<{ tokenHash: string; label?: string; expiresAt: Date; createdAt: Date }>;
  /** sha256 of the one-time code emailed after a correct password. */
  loginOtpHash?: string;
  loginOtpExpiresAt?: Date;
  loginOtpAttempts?: number;
  loginOtpSentAt?: Date;
  comparePassword(candidate: string): Promise<boolean>;
  coverProxy?: {
    coveringMemberId?: Types.ObjectId;
    startDate?: Date;
    endDate?: Date;
    active: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const FirmMemberSchema = new Schema<IFirmMember>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    initials: { type: String, required: true, uppercase: true, trim: true },
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
      default: "associate",
    },
    avatar: { type: String },
    mattersCount: { type: Number, default: 0 },
    openMattersText: { type: String },
    utilisation: { type: Number, default: 75 },
    onTimeRate: { type: Number, default: 95 },
    reworkRoundsAvg: { type: Number, default: 0.5 },
    waitingOnReviewCount: { type: Number, default: 0 },
    waitingAgeText: { type: String },
    supervision: {
      type: String,
      enum: ["light", "standard", "close"],
      default: "standard",
    },
    isActive: { type: Boolean, default: true },
    password: { type: String, select: false, minlength: 8 },
    lastLogin: { type: Date },
    emailVerifiedAt: { type: Date },
    passwordResetTokenHash: { type: String, select: false, index: true },
    passwordResetExpiresAt: { type: Date, select: false },
    passwordChangedAt: { type: Date },
    barNumber: { type: String, trim: true },
    barYearOfCall: { type: Number },
    barJurisdiction: { type: String, trim: true },
    barCertificateUrl: { type: String, trim: true },
    barStatus: {
      type: String,
      enum: ["unverified", "pending", "verified", "rejected", "skipped", "not_applicable"],
      default: "unverified",
    },
    barSubmittedAt: { type: Date },
    barVerifiedAt: { type: Date },
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, select: false },
    magicLinkTokenHash: { type: String, select: false, index: true },
    magicLinkExpiresAt: { type: Date, select: false },
    trustedDevices: {
      type: [
        {
          _id: false,
          tokenHash: { type: String, required: true },
          label: { type: String },
          expiresAt: { type: Date, required: true },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
      select: false,
    },
    loginOtpHash: { type: String, select: false },
    loginOtpExpiresAt: { type: Date, select: false },
    loginOtpAttempts: { type: Number, select: false, default: 0 },
    loginOtpSentAt: { type: Date, select: false },
    coverProxy: {
      coveringMemberId: { type: Schema.Types.ObjectId, ref: "FirmMember" },
      startDate: { type: Date },
      endDate: { type: Date },
      active: { type: Boolean, default: false },
    },
  },
  {
    timestamps: true,
    // The client reads `id`; without virtuals in toJSON only `_id` is sent,
    // which breaks every detail link and lookup that keys on id.
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

FirmMemberSchema.pre("save", async function () {
  if (!this.isModified("password") || !this.password) return;
  this.password = await bcrypt.hash(this.password, parseInt(env.BCRYPT_SALT_ROUNDS));
});

FirmMemberSchema.methods.comparePassword = async function (candidate: string): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(candidate, this.password);
};

/**
 * Never leak the hash, even if a query accidentally selects it.
 *
 * `virtuals` must be repeated here: this call replaces the `toJSON` set in the
 * schema options, so omitting it would drop the `id` the client reads.
 */
FirmMemberSchema.set("toJSON", {
  virtuals: true,
  transform: (_doc, ret) => {
    (ret as unknown as Record<string, unknown>)["password"] = undefined;
    return ret;
  },
});

export const FirmMember = model<IFirmMember>("FirmMember", FirmMemberSchema);
