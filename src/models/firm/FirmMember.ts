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
    coverProxy: {
      coveringMemberId: { type: Schema.Types.ObjectId, ref: "FirmMember" },
      startDate: { type: Date },
      endDate: { type: Date },
      active: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

FirmMemberSchema.pre("save", async function () {
  if (!this.isModified("password") || !this.password) return;
  this.password = await bcrypt.hash(this.password, parseInt(env.BCRYPT_SALT_ROUNDS));
});

FirmMemberSchema.methods.comparePassword = async function (candidate: string): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(candidate, this.password);
};

/** Never leak the hash, even if a query accidentally selects it. */
FirmMemberSchema.set("toJSON", {
  transform: (_doc, ret) => {
    (ret as unknown as Record<string, unknown>)["password"] = undefined;
    return ret;
  },
});

export const FirmMember = model<IFirmMember>("FirmMember", FirmMemberSchema);
