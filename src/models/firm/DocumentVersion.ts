import { Schema, model, Document, Types } from "mongoose";

/**
 * One version of a document. LE-027's rule is absolute: nothing is ever
 * overwritten or deleted, a new version is added on top. Restoring an older
 * one adds its content as a *new* version rather than rolling back.
 *
 * Every document the firm holds keeps this — drafts, AI drafts, templates,
 * uploads, signed copies and evidence alike.
 */
export interface IDocumentVersion extends Document {
  firmId: Types.ObjectId;
  documentId: Types.ObjectId;
  /** 1-based, rendered as v1, v2… Unique per document. */
  number: number;
  authorName: string;
  authorInitials?: string;
  /** Typed, or automatic — "First draft", "Restored v1", "Signed by …". */
  note: string;
  /** The document's status at the moment this version was taken. */
  status: string;
  /** The full body, so a version can be viewed and restored on its own. */
  html: string;
  /** Bytes, for the history panel. */
  size: number;
  createdAt: Date;
  updatedAt: Date;
}

const DocumentVersionSchema = new Schema<IDocumentVersion>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    documentId: { type: Schema.Types.ObjectId, ref: "FirmDocument", required: true, index: true },
    number: { type: Number, required: true },
    authorName: { type: String, required: true },
    authorInitials: { type: String },
    note: { type: String, default: "" },
    status: { type: String, default: "draft" },
    html: { type: String, default: "" },
    size: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Version numbers are per document, and two saves must not race into the same
// one. The unique index is what actually enforces that, not the read-then-write.
DocumentVersionSchema.index({ documentId: 1, number: 1 }, { unique: true });

export const DocumentVersion = model<IDocumentVersion>("DocumentVersion", DocumentVersionSchema);
