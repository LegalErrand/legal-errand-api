import { Schema, model, Document, Types } from "mongoose";

// The shape here is the contract with legalerrand-firm-app's
// src/lib/intake-form.ts — the editor and the public form both read it.

export type IntakeAnswerType = "short" | "paragraph" | "choice" | "yesno" | "date" | "file";

export const INTAKE_ANSWER_TYPES: IntakeAnswerType[] = [
  "short",
  "paragraph",
  "choice",
  "yesno",
  "date",
  "file",
];

export interface IntakeQuestion {
  id: string;
  label: string;
  type: IntakeAnswerType;
  hint?: string;
  options?: string[];
  required?: boolean;
  hidden?: boolean;
  /** Answering with this value flags the whole intake as urgent. */
  urgentWhen?: string;
}

export interface IntakeStep {
  /** 1–5, matching the five-segment progress bar. */
  step: number;
  title: string;
  intro?: string;
  questions: IntakeQuestion[];
}

export interface PracticeAreaQuestions {
  area: string;
  questions: IntakeQuestion[];
}

/** The editable form itself — what the public form and the editor exchange. */
export interface IntakeFormContent {
  firmName?: string;
  firmLogoUrl?: string;
  /** The firm's brand colour, used for the header and progress bar. */
  brandColor?: string;
  steps: IntakeStep[];
  practiceAreas: PracticeAreaQuestions[];
  consentText: string;
}

/**
 * One document per firm. Edits land in `draftVersion`; the public form is only
 * ever served `publishedVersion`, so an unfinished edit can never reach a
 * prospective client.
 */
export interface IIntakeFormSchema extends Document {
  firmId: Types.ObjectId;
  steps: IntakeStep[];
  practiceAreas: PracticeAreaQuestions[];
  consentText: string;
  /** Null until the firm publishes for the first time. */
  publishedVersion?: IntakeFormContent;
  draftVersion: IntakeFormContent;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const QuestionSchema = new Schema<IntakeQuestion>(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, enum: INTAKE_ANSWER_TYPES, required: true },
    hint: { type: String },
    options: { type: [String], default: undefined },
    required: { type: Boolean },
    hidden: { type: Boolean },
    urgentWhen: { type: String },
  },
  { _id: false }
);

const StepSchema = new Schema<IntakeStep>(
  {
    step: { type: Number, required: true },
    title: { type: String, required: true },
    intro: { type: String },
    questions: { type: [QuestionSchema], default: [] },
  },
  { _id: false }
);

const PracticeAreaSchema = new Schema<PracticeAreaQuestions>(
  {
    area: { type: String, required: true },
    questions: { type: [QuestionSchema], default: [] },
  },
  { _id: false }
);

const ContentSchema = new Schema<IntakeFormContent>(
  {
    firmName: { type: String },
    firmLogoUrl: { type: String },
    brandColor: { type: String },
    steps: { type: [StepSchema], default: [] },
    practiceAreas: { type: [PracticeAreaSchema], default: [] },
    consentText: { type: String, default: "" },
  },
  { _id: false }
);

const IntakeFormSchemaSchema = new Schema<IIntakeFormSchema>(
  {
    firmId: {
      type: Schema.Types.ObjectId,
      ref: "Firm",
      required: true,
      index: true,
      unique: true,
    },
    // Kept alongside draft/published so a reader that wants "the form" as the
    // front end types it can take the top level: it mirrors the draft.
    steps: { type: [StepSchema], default: [] },
    practiceAreas: { type: [PracticeAreaSchema], default: [] },
    consentText: { type: String, default: "" },
    publishedVersion: { type: ContentSchema, default: undefined },
    draftVersion: { type: ContentSchema, required: true },
    publishedAt: { type: Date },
  },
  {
    timestamps: true,
    // The client reads `id`; without virtuals in toJSON only `_id` is sent,
    // which breaks every detail link and lookup that keys on id.
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

export const IntakeFormSchemaModel = model<IIntakeFormSchema>(
  "IntakeFormSchema",
  IntakeFormSchemaSchema
);
