import mongoose, { Schema, Document } from "mongoose";
import { LawSubject } from "../utils/constants";

// ─── Daily Progress Entry ─────────────────────────────────────────────────────

export interface IProgressDocument extends Document {
  userId: mongoose.Types.ObjectId;
  date: string; // YYYY-MM-DD
  studyMinutes: number;
  aiQueriesCount: number;
  casesExplained: number;
  notesCreated: number;
  questionsAnswered: number;
  researchSessions: number;
  subjectActivity: Partial<Record<LawSubject, number>>;
}

const ProgressSchema = new Schema<IProgressDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    date: { type: String, required: true },
    studyMinutes: { type: Number, default: 0 },
    aiQueriesCount: { type: Number, default: 0 },
    casesExplained: { type: Number, default: 0 },
    notesCreated: { type: Number, default: 0 },
    questionsAnswered: { type: Number, default: 0 },
    researchSessions: { type: Number, default: 0 },
    subjectActivity: { type: Map, of: Number, default: {} },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

ProgressSchema.index({ userId: 1, date: 1 }, { unique: true });

export const Progress = mongoose.model<IProgressDocument>("Progress", ProgressSchema);

// ─── Legal Reasoning Score ────────────────────────────────────────────────────

export interface IReasoningScoreDocument extends Document {
  userId: mongoose.Types.ObjectId;
  overall: number;
  components: {
    issueIdentification: number;
    ruleApplication: number;
    legalAnalysis: number;
    caseCitation: number;
    consistency: number;
    improvementRate: number;
  };
  bySubject: Map<string, number>;
  calculatedAt: Date;
}

const ReasoningScoreSchema = new Schema<IReasoningScoreDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    overall: { type: Number, min: 0, max: 100, default: 0 },
    components: {
      issueIdentification: { type: Number, default: 0 },
      ruleApplication: { type: Number, default: 0 },
      legalAnalysis: { type: Number, default: 0 },
      caseCitation: { type: Number, default: 0 },
      consistency: { type: Number, default: 0 },
      improvementRate: { type: Number, default: 0 },
    },
    bySubject: { type: Map, of: Number, default: {} },
    calculatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

ReasoningScoreSchema.index({ userId: 1, calculatedAt: -1 });

export const ReasoningScore = mongoose.model<IReasoningScoreDocument>(
  "ReasoningScore",
  ReasoningScoreSchema
);
