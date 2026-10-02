import { Schema, model, Document, Types } from "mongoose";

/**
 * The client↔firm thread behind the portal's Messages tab (LE-035).
 *
 * Kept apart from `FirmMessage` on purpose: that model carries internal fields
 * (suggested replies, confidence, auto-send) which must never reach a client.
 * Everything in this collection was written to be read by the client.
 */
export interface IPortalMessage extends Document {
  firmId: Types.ObjectId;
  clientId: Types.ObjectId;
  matterId?: Types.ObjectId;
  from: "client" | "firm";
  /** The lawyer's name on firm replies; the client's own name otherwise. */
  authorName?: string;
  body: string;
  sentAt: Date;
  /**
   * Set when the client used "Raise it with the partner": the message bypasses
   * their lawyer and is owed an answer within two hours.
   */
  raisedWithPartner: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PortalMessageSchema = new Schema<IPortalMessage>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    matterId: { type: Schema.Types.ObjectId, ref: "Matter", index: true },
    from: { type: String, enum: ["client", "firm"], required: true },
    authorName: { type: String, trim: true },
    body: { type: String, required: true, trim: true },
    sentAt: { type: Date, required: true, default: Date.now },
    raisedWithPartner: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

PortalMessageSchema.index({ firmId: 1, clientId: 1, sentAt: 1 });

export const PortalMessage = model<IPortalMessage>("PortalMessage", PortalMessageSchema);
