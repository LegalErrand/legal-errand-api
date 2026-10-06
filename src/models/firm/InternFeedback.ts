import { Schema, model, Document, Types } from "mongoose";

/**
 * A supervisor's written feedback to an intern (LE-046).
 *
 * The intern reads it and nothing more: there is no intern-facing endpoint that
 * creates, edits or deletes feedback.
 */
export interface IInternFeedback extends Document {
  firmId: Types.ObjectId;
  ownerId: Types.ObjectId;
  placementId: Types.ObjectId;
  authorId: Types.ObjectId;
  authorName: string;
  authorRole?: string;
  body: string;
  matterName?: string;
  /** 1–5, when the supervisor rated the work. */
  rating?: number;
  createdAt: Date;
  updatedAt: Date;
}

const InternFeedbackSchema = new Schema<IInternFeedback>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "FirmMember", required: true, index: true },
    placementId: { type: Schema.Types.ObjectId, ref: "InternPlacement", required: true },
    authorId: { type: Schema.Types.ObjectId, ref: "FirmMember", required: true },
    authorName: { type: String, required: true },
    authorRole: { type: String },
    body: { type: String, required: true, trim: true },
    matterName: { type: String },
    rating: { type: Number, min: 1, max: 5 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

InternFeedbackSchema.index({ firmId: 1, ownerId: 1, createdAt: -1 });

export const InternFeedback = model<IInternFeedback>("InternFeedback", InternFeedbackSchema);
