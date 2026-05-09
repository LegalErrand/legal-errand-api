import mongoose, { Schema, Document } from "mongoose";
import bcrypt from "bcryptjs";
import { env } from "../config/env";

export const ADMIN_ROLES = ["super_admin", "content_admin", "support_admin"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export interface IAdminDocument extends Document {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  role: AdminRole;
  isBlocked: boolean;
  blockedAt?: Date;
  blockedReason?: string;
  createdBy?: mongoose.Types.ObjectId;
  lastLogin?: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

const AdminSchema = new Schema<IAdminDocument>(
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
    role: { type: String, enum: ADMIN_ROLES, required: true, default: "support_admin" },
    isBlocked: { type: Boolean, default: false },
    blockedAt: { type: Date },
    blockedReason: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    lastLogin: { type: Date },
  },
  { timestamps: true }
);

AdminSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, parseInt(env.BCRYPT_SALT_ROUNDS));
});

AdminSchema.methods.comparePassword = async function (candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

AdminSchema.set("toJSON", {
  transform: (_doc, ret) => {
    (ret as unknown as Record<string, unknown>)["password"] = undefined;
    return ret;
  },
});

export const Admin = mongoose.model<IAdminDocument>("Admin", AdminSchema);
