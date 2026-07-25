import mongoose, { Schema, Document } from "mongoose";

export const GOAL_UNITS = [
  "hours",
  "questions",
  "notes",
  "cases",
  "sessions",
  "flashcards",
] as const;
export type GoalUnit = (typeof GOAL_UNITS)[number];

export interface IGoalDocument extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  targetValue: number;
  currentValue: number;
  unit: GoalUnit;
  deadline?: Date;
  isCompleted: boolean;
  completedAt?: Date;
}

const GoalSchema = new Schema<IGoalDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    targetValue: { type: Number, required: true, min: 1 },
    currentValue: { type: Number, default: 0, min: 0 },
    unit: { type: String, enum: GOAL_UNITS, required: true },
    deadline: { type: Date },
    isCompleted: { type: Boolean, default: false },
    completedAt: { type: Date },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

GoalSchema.index({ userId: 1, isCompleted: 1 });

export const Goal = mongoose.model<IGoalDocument>("Goal", GoalSchema);
