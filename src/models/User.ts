import mongoose, { Schema, Document } from "mongoose";
import bcrypt from "bcryptjs";
import { SUBSCRIPTION_TIERS, SubscriptionTier } from "../utils/constants";
import { env } from "../config/env";

export interface IUserDocument extends Document {
  name: string;
  email: string;
  password: string;
  university?: string;
  yearOfStudy?: number;
  tier: SubscriptionTier;
  avatar?: string;
  isEmailVerified: boolean;
  comparePassword(candidate: string): Promise<boolean>;
}

const UserSchema = new Schema<IUserDocument>(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Invalid email format"],
    },
    password: { type: String, required: true, minlength: 8, select: false },
    university: { type: String, trim: true },
    yearOfStudy: { type: Number, min: 1, max: 7 },
    tier: { type: String, enum: SUBSCRIPTION_TIERS, default: "free" },
    avatar: { type: String },
    isEmailVerified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Hash password before save
UserSchema.pre("save", async function () {
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
