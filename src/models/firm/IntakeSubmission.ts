import { Schema, model, Document, Types } from "mongoose";

/**
 * One public intake — either a part-finished form the person can resume, or a
 * submitted enquiry that produced a lead client.
 */
export interface IIntakeSubmission extends Document {
  firmId: Types.ObjectId;
  status: "saved" | "submitted";
  /** Short human reference shown to the person after sending ("IN-7F3K9A"). */
  reference?: string;
  email?: string;
  answers: Record<string, string>;
  documentIds: string[];
  consentGiven: boolean;
  consentText?: string;
  /** True when an answer matched a question's `urgentWhen`. */
  urgent: boolean;
  urgentReasons: string[];
  /** sha256 of the resume link token. The raw token is only ever returned once. */
  resumeTokenHash?: string;
  resumeExpiresAt?: Date;
  clientId?: Types.ObjectId;
  savedAt?: Date;
  submittedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const IntakeSubmissionSchema = new Schema<IIntakeSubmission>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    status: { type: String, enum: ["saved", "submitted"], default: "saved", index: true },
    reference: { type: String, index: true },
    email: { type: String, lowercase: true, trim: true },
    answers: { type: Schema.Types.Mixed, default: {} },
    documentIds: { type: [String], default: [] },
    consentGiven: { type: Boolean, default: false },
    consentText: { type: String },
    urgent: { type: Boolean, default: false, index: true },
    urgentReasons: { type: [String], default: [] },
    resumeTokenHash: { type: String, index: true },
    resumeExpiresAt: { type: Date },
    clientId: { type: Schema.Types.ObjectId, ref: "Client" },
    savedAt: { type: Date },
    submittedAt: { type: Date },
  },
  {
    timestamps: true,
    // The client reads `id`; without virtuals in toJSON only `_id` is sent,
    // which breaks every detail link and lookup that keys on id.
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

export const IntakeSubmission = model<IIntakeSubmission>(
  "IntakeSubmission",
  IntakeSubmissionSchema
);
