import { Schema, model, Document, Types } from "mongoose";

/** A call a client booked from the portal (LE-035, "Book a call"). */
export interface IPortalBooking extends Document {
  firmId: Types.ObjectId;
  clientId: Types.ObjectId;
  matterId?: Types.ObjectId;
  lawyerId?: Types.ObjectId;
  startsAt: Date;
  /** The zone the slot was offered in, so the client's confirmation reads correctly. */
  timeZone: string;
  status: "booked" | "cancelled";
  createdAt: Date;
  updatedAt: Date;
}

const PortalBookingSchema = new Schema<IPortalBooking>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    matterId: { type: Schema.Types.ObjectId, ref: "Matter" },
    lawyerId: { type: Schema.Types.ObjectId, ref: "FirmMember" },
    startsAt: { type: Date, required: true },
    timeZone: { type: String, required: true, default: "Africa/Lagos" },
    status: { type: String, enum: ["booked", "cancelled"], default: "booked" },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

PortalBookingSchema.index({ firmId: 1, startsAt: 1 });

export const PortalBooking = model<IPortalBooking>("PortalBooking", PortalBookingSchema);
