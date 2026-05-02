import mongoose, { Schema, Document } from "mongoose";
import { LAW_SUBJECTS, LawSubject, NOTE_SOURCES, NoteSource } from "../utils/constants";

export interface INoteDocument extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  content: string;
  subject?: LawSubject;
  tags: string[];
  source: NoteSource;
  sourceRef?: string;
  qualityScore?: number;
  qualityFeedback?: string;
  folder?: string;
  linkedDocumentId?: mongoose.Types.ObjectId;
}

const NoteSchema = new Schema<INoteDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    subject: { type: String, enum: LAW_SUBJECTS },
    tags: [{ type: String, lowercase: true, trim: true }],
    source: { type: String, enum: NOTE_SOURCES, default: "manual" },
    sourceRef: { type: String },
    qualityScore: { type: Number, min: 0, max: 100 },
    qualityFeedback: { type: String },
    folder: { type: String, default: "General" },
    linkedDocumentId: { type: Schema.Types.ObjectId, ref: "Document" },
  },
  { timestamps: true }
);

NoteSchema.index({ userId: 1, subject: 1 });
NoteSchema.index({ userId: 1, tags: 1 });
NoteSchema.index({ userId: 1, folder: 1 });
NoteSchema.index({ title: "text", content: "text" });

export const Note = mongoose.model<INoteDocument>("Note", NoteSchema);
