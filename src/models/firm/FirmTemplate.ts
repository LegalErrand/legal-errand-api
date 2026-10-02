import { Schema, model, Document, Types } from "mongoose";

/**
 * LE-029 — a template the firm uploaded itself.
 *
 * The 39 built-ins ship with the client as config; this collection holds only
 * the firm's own uploads and any override it saves over a built-in (in which
 * case `builtInId` names the built-in it replaces).
 */

export const TEMPLATE_GROUPS = [
  "Agreements",
  "Letters",
  "Court documents",
  "Corporate",
  "Deeds and property",
  "Estate and probate",
  "Notices",
  "Policies",
  "Other",
] as const;
export type TemplateGroup = (typeof TEMPLATE_GROUPS)[number];

/**
 * LE-029's letterhead rule: court processes and wills open on the court
 * heading, everything else on the firm letterhead.
 */
export const HEADING_TYPES = ["letterhead", "court"] as const;
export type HeadingType = (typeof HEADING_TYPES)[number];

export interface IFirmTemplate extends Document {
  firmId: Types.ObjectId;
  name: string;
  group: TemplateGroup;
  heading: HeadingType;
  description: string;
  /** Empty when the body still has to come from the firm. */
  body: string;
  /** Set when this record overrides one of the client-side built-ins. */
  builtInId?: string;
  sizeBytes?: number;
  uploadedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const firmTemplateSchema = new Schema<IFirmTemplate>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    name: { type: String, required: true, trim: true },
    group: { type: String, enum: TEMPLATE_GROUPS, required: true, default: "Other" },
    heading: { type: String, enum: HEADING_TYPES, required: true, default: "letterhead" },
    description: { type: String, default: "" },
    body: { type: String, default: "" },
    builtInId: { type: String, trim: true },
    sizeBytes: { type: Number },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "FirmMember", required: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

firmTemplateSchema.index({ firmId: 1, group: 1, name: 1 });

export const FirmTemplate = model<IFirmTemplate>("FirmTemplate", firmTemplateSchema);
