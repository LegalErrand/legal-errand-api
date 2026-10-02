import { Schema, model, Document, Types } from "mongoose";

/**
 * LE-029 — a reusable clause the firm holds, inserted from the editor's clause
 * library.
 *
 * Nothing ships seeded. These bodies end up in documents that get filed at
 * court, so every clause in here was written or approved by the firm itself —
 * there is deliberately no built-in list to fall back on.
 */
export interface IFirmClause extends Document {
  firmId: Types.ObjectId;
  title: string;
  /** Free text, so a firm can use its own filing language. */
  category: string;
  /** The clause itself, as HTML (what the editor inserts). */
  body: string;
  /** Denormalised for the panel, which lists who added each clause. */
  createdByName: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const firmClauseSchema = new Schema<IFirmClause>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    title: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true, default: "General" },
    body: { type: String, required: true },
    createdByName: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "FirmMember", required: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

firmClauseSchema.index({ firmId: 1, category: 1, title: 1 });

export const FirmClause = model<IFirmClause>("FirmClause", firmClauseSchema);
