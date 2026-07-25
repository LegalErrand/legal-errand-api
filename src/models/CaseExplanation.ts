import mongoose, { Schema, Document } from "mongoose";

export interface ICaseExplanationDocument extends Document {
  userId: mongoose.Types.ObjectId;
  documentId?: mongoose.Types.ObjectId;
  inputText: string;
  citation: string;
  facts: string;
  issue: string;
  holding: string;
  reasoning: string;
  significance: string;
  relatedCases: string[];
  practiceQuestions: string[];
  savedToNoteId?: mongoose.Types.ObjectId;
}

const CaseExplanationSchema = new Schema<ICaseExplanationDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    documentId: { type: Schema.Types.ObjectId, ref: "Document" },
    inputText: { type: String, required: true },
    citation: { type: String, default: "" },
    facts: { type: String, default: "" },
    issue: { type: String, default: "" },
    holding: { type: String, default: "" },
    reasoning: { type: String, default: "" },
    significance: { type: String, default: "" },
    relatedCases: [{ type: String }],
    practiceQuestions: [{ type: String }],
    savedToNoteId: { type: Schema.Types.ObjectId, ref: "Note" },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

CaseExplanationSchema.index({ userId: 1, createdAt: -1 });

export const CaseExplanation = mongoose.model<ICaseExplanationDocument>(
  "CaseExplanation",
  CaseExplanationSchema
);
