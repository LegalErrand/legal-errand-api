import { Schema, model, Document, Types } from "mongoose";

/**
 * One document the firm has explicitly shared with a client, or one the client
 * has sent in (LE-035).
 *
 * A document is visible in the portal only because a row exists here. Nothing
 * about `FirmDocument` itself — not its status, not its matter — makes it
 * reachable, so a draft or an internal paper can never leak by default.
 */
export type PortalShareDirection = "from_firm" | "from_client";

export interface IPortalShare extends Document {
  firmId: Types.ObjectId;
  clientId: Types.ObjectId;
  matterId?: Types.ObjectId;
  documentId: Types.ObjectId;
  /** Snapshot of the name as shared, so a later internal rename cannot surprise the client. */
  name: string;
  direction: PortalShareDirection;
  sharedAt: Date;
  /** When the client opened it — drives the "Read" status on the Documents tab. */
  readAt?: Date;
  needsSignature: boolean;
  /** When the firm acknowledged a client upload — the "Received" status. */
  receivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PortalShareSchema = new Schema<IPortalShare>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    matterId: { type: Schema.Types.ObjectId, ref: "Matter", index: true },
    documentId: { type: Schema.Types.ObjectId, ref: "FirmDocument", required: true },
    name: { type: String, required: true, trim: true },
    direction: {
      type: String,
      enum: ["from_firm", "from_client"],
      required: true,
      default: "from_firm",
    },
    sharedAt: { type: Date, required: true, default: Date.now },
    readAt: { type: Date },
    needsSignature: { type: Boolean, default: false },
    receivedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Every portal read is "this firm, this client, newest first".
PortalShareSchema.index({ firmId: 1, clientId: 1, sharedAt: -1 });

export const PortalShare = model<IPortalShare>("PortalShare", PortalShareSchema);
