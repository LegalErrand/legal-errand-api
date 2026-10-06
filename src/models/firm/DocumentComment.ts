import { Schema, model, Document, Types } from "mongoose";

/**
 * A comment on a document, with its thread.
 *
 * LE-027: a comment stays attached to the version it was made on, so
 * `versionNumber` is recorded rather than inferred later. `quote` holds the
 * text it was anchored to — when an edit moves or removes that text the
 * comment still has something to show rather than pointing at nothing.
 */
export interface IDocumentCommentReply {
  _id?: Types.ObjectId;
  authorName: string;
  authorInitials?: string;
  text: string;
  createdAt: Date;
}

export interface IDocumentComment extends Document {
  firmId: Types.ObjectId;
  documentId: Types.ObjectId;
  authorName: string;
  authorInitials?: string;
  text: string;
  quote: string;
  resolved: boolean;
  versionNumber?: number;
  replies: IDocumentCommentReply[];
  createdAt: Date;
  updatedAt: Date;
}

const ReplySchema = new Schema<IDocumentCommentReply>(
  {
    authorName: { type: String, required: true },
    authorInitials: { type: String },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const DocumentCommentSchema = new Schema<IDocumentComment>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    documentId: { type: Schema.Types.ObjectId, ref: "FirmDocument", required: true, index: true },
    authorName: { type: String, required: true },
    authorInitials: { type: String },
    text: { type: String, required: true },
    quote: { type: String, default: "" },
    resolved: { type: Boolean, default: false, index: true },
    versionNumber: { type: Number },
    replies: { type: [ReplySchema], default: [] },
  },
  { timestamps: true }
);

export const DocumentComment = model<IDocumentComment>("DocumentComment", DocumentCommentSchema);
