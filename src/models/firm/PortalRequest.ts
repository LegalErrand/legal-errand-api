import { Schema, model, Document, Types } from "mongoose";

/**
 * Something the firm has asked this client for (LE-035, "What we need from you").
 *
 * Deliberately a client-facing record rather than a task: `FirmTask` carries
 * internal work and internal wording, neither of which may reach the portal.
 */
export interface IPortalRequest extends Document {
  firmId: Types.ObjectId;
  clientId: Types.ObjectId;
  matterId?: Types.ObjectId;
  /** Plain-English wording shown to the client. */
  label: string;
  askedOn: Date;
  dueOn?: Date;
  outstanding: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PortalRequestSchema = new Schema<IPortalRequest>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    matterId: { type: Schema.Types.ObjectId, ref: "Matter", index: true },
    label: { type: String, required: true, trim: true },
    askedOn: { type: Date, required: true, default: Date.now },
    dueOn: { type: Date },
    outstanding: { type: Boolean, default: true, index: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

PortalRequestSchema.index({ firmId: 1, clientId: 1, outstanding: 1 });

export const PortalRequest = model<IPortalRequest>("PortalRequest", PortalRequestSchema);
