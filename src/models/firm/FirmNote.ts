import { Schema, model, Document, Types } from "mongoose";

/**
 * What the team knows about a firm that the numbers do not say — who prefers
 * WhatsApp, who is waiting on a hire before they upgrade.
 *
 * Visible to LegalErrand admins only. A firm never sees these, which is exactly
 * why they must stay about the commercial relationship and not about the firm's
 * clients or their cases.
 */
export interface IFirmNote extends Document {
  firmId: Types.ObjectId;
  adminId: Types.ObjectId;
  /** Who wrote it, kept verbatim so the note survives the author leaving. */
  authorName: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

const firmNoteSchema = new Schema<IFirmNote>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    adminId: { type: Schema.Types.ObjectId, ref: "Admin", required: true },
    authorName: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true, maxlength: 4000 },
  },
  { timestamps: true }
);

firmNoteSchema.index({ firmId: 1, createdAt: -1 });

export const FirmNote = model<IFirmNote>("FirmNote", firmNoteSchema);
