import mongoose, { Schema, Document } from "mongoose";
import { DOCUMENT_TYPES, DocumentType, LAW_SUBJECTS, LawSubject } from "../utils/constants";

export interface IDocumentDocument extends Document {
  title: string;
  type: DocumentType;
  subject?: LawSubject;
  s3Key: string;
  s3Url: string;
  fileSize: number;
  uploadedBy?: mongoose.Types.ObjectId;
  isLibraryContent: boolean;
  metadata: {
    court?: string;
    year?: number;
    citation?: string;
    jurisdiction?: string;
    description?: string;
  };
  bookmarks: mongoose.Types.ObjectId[];
}

const DocumentSchema = new Schema<IDocumentDocument>(
  {
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: DOCUMENT_TYPES, required: true },
    subject: { type: String, enum: LAW_SUBJECTS },
    s3Key: { type: String, required: true },
    s3Url: { type: String, required: true },
    fileSize: { type: Number, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
    isLibraryContent: { type: Boolean, default: false },
    metadata: {
      court: String,
      year: Number,
      citation: String,
      jurisdiction: { type: String, default: "Nigeria" },
      description: String,
    },
    bookmarks: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

DocumentSchema.index({ subject: 1, type: 1 });
DocumentSchema.index({ uploadedBy: 1 });
DocumentSchema.index({ isLibraryContent: 1 });
DocumentSchema.index({ title: "text", "metadata.description": "text" });

export const LibraryDocument = mongoose.model<IDocumentDocument>("Document", DocumentSchema);
