import mongoose, { Schema, Document } from "mongoose";
import bcrypt from "bcryptjs";
import { SUBSCRIPTION_TIERS, SubscriptionTier } from "../utils/constants";
import { env } from "../config/env";

export interface IUserDocument extends Document {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  accountType: "Undergraduate" | "Law School Student";
  username?: string;
  country?: string;
  city?: string;
  schoolName?: string;
  levelYear?: string;
  matricNumber?: string;
  phoneNumber?: string;
  referralKey: string;
  referredBy?: mongoose.Types.ObjectId;
  studyStreak: number;
  lastStudyDate?: Date;
  lastLogin?: Date;
  subjectMastery: Array<{
    subjectName: string;
    masteryPercentage: number;
  }>;
  tier: SubscriptionTier;
  avatar?: string;
  isEmailVerified: boolean;
  isBlocked: boolean;
  blockedAt?: Date;
  blockedReason?: string;
  resetPasswordOtp?: string;
  resetPasswordOtpExpires?: Date;
  verificationOtp?: string;
  verificationOtpExpires?: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

const UserSchema = new Schema<IUserDocument>(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Invalid email format"],
    },
    password: { type: String, required: true, minlength: 8, select: false },
    accountType: { type: String, enum: ["Undergraduate", "Law School Student"], required: true },
    username: { type: String, trim: true },
    country: { type: String, trim: true },
    city: { type: String, trim: true },
    schoolName: { type: String, trim: true },
    levelYear: { type: String, trim: true },
    matricNumber: { type: String, trim: true },
    phoneNumber: { type: String, trim: true },
    referralKey: { type: String, unique: true, sparse: true, index: true },
    referredBy: { type: Schema.Types.ObjectId, ref: "User", index: true },
    studyStreak: { type: Number, default: 0 },
    lastStudyDate: { type: Date },
    lastLogin: { type: Date },
    subjectMastery: [
      {
        subjectName: { type: String, required: true },
        masteryPercentage: { type: Number, default: 0, min: 0, max: 100 },
      },
    ],
    tier: { type: String, enum: SUBSCRIPTION_TIERS, default: "free" },
    avatar: { type: String },
    isEmailVerified: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false, index: true },
    blockedAt: { type: Date },
    blockedReason: { type: String },
    resetPasswordOtp: { type: String },
    resetPasswordOtpExpires: { type: Date },
    verificationOtp: { type: String },
    verificationOtpExpires: { type: Date },
  },
  { timestamps: true }
);

// Hash password and generate referral key before save
UserSchema.pre("save", async function () {
  if (this.isNew && !this.referralKey) {
    // Generate a simple alphanumeric referral key (e.g. FIRSTNAME-RANDOM)
    const randomChars = Math.random().toString(36).substring(2, 6).toUpperCase();
    const baseName = this.firstName
      ? this.firstName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
      : "USER";
    this.referralKey = `${baseName}-${randomChars}`;
  }

  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, parseInt(env.BCRYPT_SALT_ROUNDS));
});

UserSchema.methods.comparePassword = async function (candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

// Never leak password
UserSchema.set("toJSON", {
  transform: (_doc, ret) => {
    (ret as unknown as Record<string, unknown>)["password"] = undefined;
    return ret;
  },
});

export const User = mongoose.model<IUserDocument>("User", UserSchema);
