import { Schema, model, Document, Types } from "mongoose";

/**
 * One item of an intern's learning-goals checklist (LE-046).
 *
 * The intern may tick a goal done and nothing else: the wording, order and
 * target come from the supervisor who set the placement.
 */
export interface IInternLearningGoal extends Document {
  firmId: Types.ObjectId;
  ownerId: Types.ObjectId;
  placementId: Types.ObjectId;
  title: string;
  detail?: string;
  done: boolean;
  doneAt?: Date;
  /** Lower sorts first; set by whoever wrote the goal. */
  order: number;
  /**
   * Court-attendance goals are ticked by attending sittings rather than by
   * hand, so the intern cannot tick one without a logbook line behind it.
   */
  kind: "manual" | "sittings";
  createdAt: Date;
  updatedAt: Date;
}

const InternLearningGoalSchema = new Schema<IInternLearningGoal>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "FirmMember", required: true, index: true },
    placementId: { type: Schema.Types.ObjectId, ref: "InternPlacement", required: true },
    title: { type: String, required: true, trim: true },
    detail: { type: String },
    done: { type: Boolean, default: false },
    doneAt: { type: Date },
    order: { type: Number, default: 0 },
    kind: { type: String, enum: ["manual", "sittings"], default: "manual" },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

InternLearningGoalSchema.index({ firmId: 1, ownerId: 1, order: 1 });

export const InternLearningGoal = model<IInternLearningGoal>(
  "InternLearningGoal",
  InternLearningGoalSchema
);
