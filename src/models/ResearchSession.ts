import mongoose, { Schema, Document } from "mongoose";
import { DOCUMENT_TYPES, DocumentType } from "../utils/constants";

interface ResearchResult {
  documentId?: mongoose.Types.ObjectId;
  title: string;
  snippet: string;
  relevanceScore: number;
  type: DocumentType;
  citation?: string;
}

export interface IResearchSessionDocument extends Document {
  userId: mongoose.Types.ObjectId;
  query: string;
  refinedQuery?: string;
  results: ResearchResult[];
  savedSources: mongoose.Types.ObjectId[];
  memo?: string;
  qualityScore?: number;
  missedSources?: string[];
}

const ResearchResultSchema = new Schema<ResearchResult>(
  {
    documentId: { type: Schema.Types.ObjectId, ref: "Document" },
    title: { type: String, required: true },
    snippet: { type: String, required: true },
    relevanceScore: { type: Number, min: 0, max: 1 },
    type: { type: String, enum: DOCUMENT_TYPES },
    citation: { type: String },
  },
  { _id: false }
);

const ResearchSessionSchema = new Schema<IResearchSessionDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    query: { type: String, required: true },
    refinedQuery: { type: String },
    results: [ResearchResultSchema],
    savedSources: [{ type: Schema.Types.ObjectId, ref: "Document" }],
    memo: { type: String },
    qualityScore: { type: Number, min: 0, max: 100 },
    missedSources: [{ type: String }],
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

ResearchSessionSchema.index({ userId: 1, createdAt: -1 });

export const ResearchSession = mongoose.model<IResearchSessionDocument>(
  "ResearchSession",
  ResearchSessionSchema
);
