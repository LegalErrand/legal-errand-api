import mongoose, { Schema, Document } from "mongoose";

export interface IWaitlistDocument extends Document {
  firstName: string;
  email: string;
  universityName: string;
  phone: string;
  level: string;
  country: string;
}

const WaitlistSchema = new Schema<IWaitlistDocument>(
  {
    firstName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Invalid email format"],
    },
    universityName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    level: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

export const Waitlist = mongoose.model<IWaitlistDocument>("Waitlist", WaitlistSchema);
