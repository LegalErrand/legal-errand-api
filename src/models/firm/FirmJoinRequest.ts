import { Schema, model, Document, Types } from "mongoose";

/**
 * Someone asking to be let into a firm that already owns their email domain.
 *
 * The alternative is that they create a second firm on the same domain and the
 * practice ends up split across two accounts that cannot see each other's
 * matters, which is far harder to undo than a request sitting in a queue.
 */
export interface IFirmJoinRequest extends Document {
  firmId: Types.ObjectId;
  email: string;
  note?: string;
  status: "pending" | "approved" | "declined";
  decidedBy?: Types.ObjectId;
  decidedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const FirmJoinRequestSchema = new Schema<IFirmJoinRequest>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    note: { type: String, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: ["pending", "approved", "declined"],
      default: "pending",
      index: true,
    },
    decidedBy: { type: Schema.Types.ObjectId, ref: "FirmMember" },
    decidedAt: { type: Date },
  },
  { timestamps: true }
);

// One live request per address per firm; asking again refreshes rather than piles up.
FirmJoinRequestSchema.index({ firmId: 1, email: 1, status: 1 });

export const FirmJoinRequest = model<IFirmJoinRequest>("FirmJoinRequest", FirmJoinRequestSchema);
