import mongoose, { Schema, Document } from "mongoose";
import {
  LAW_SUBJECTS,
  LawSubject,
  DIFFICULTY_LEVELS,
  DifficultyLevel,
  QUESTION_TYPES,
  QuestionType,
} from "../utils/constants";

export interface IQuestionDocument extends Document {
  type: QuestionType;
  subject: LawSubject;
  difficulty: DifficultyLevel;
  prompt: string;
  modelAnswer?: string;
  gradingNotes?: string;
  tags: string[];
  isActive: boolean;
}

const QuestionSchema = new Schema<IQuestionDocument>(
  {
    type: { type: String, enum: QUESTION_TYPES, required: true },
    subject: { type: String, enum: LAW_SUBJECTS, required: true },
    difficulty: { type: String, enum: DIFFICULTY_LEVELS, required: true },
    prompt: { type: String, required: true },
    modelAnswer: { type: String },
    gradingNotes: { type: String },
    tags: [{ type: String, lowercase: true }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

QuestionSchema.index({ subject: 1, difficulty: 1, type: 1 });
QuestionSchema.index({ isActive: 1 });

export const Question = mongoose.model<IQuestionDocument>("Question", QuestionSchema);

// ─── Question Attempts ────────────────────────────────────────────────────────

export interface IQuestionAttemptDocument extends Document {
  userId: mongoose.Types.ObjectId;
  questionId: mongoose.Types.ObjectId;
  answer: string;
  scores: {
    issueIdentification: number;
    ruleStatement: number;
    application: number;
    conclusion: number;
    total: number;
  };
  aiFeedback: string;
}

const QuestionAttemptSchema = new Schema<IQuestionAttemptDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    questionId: { type: Schema.Types.ObjectId, ref: "Question", required: true },
    answer: { type: String, required: true },
    scores: {
      issueIdentification: { type: Number, min: 0, max: 100 },
      ruleStatement: { type: Number, min: 0, max: 100 },
      application: { type: Number, min: 0, max: 100 },
      conclusion: { type: Number, min: 0, max: 100 },
      total: { type: Number, min: 0, max: 100 },
    },
    aiFeedback: { type: String },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

QuestionAttemptSchema.index({ userId: 1, createdAt: -1 });
QuestionAttemptSchema.index({ userId: 1, questionId: 1 });

export const QuestionAttempt = mongoose.model<IQuestionAttemptDocument>(
  "QuestionAttempt",
  QuestionAttemptSchema
);
