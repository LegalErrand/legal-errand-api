import { Schema, model, Document, Types } from "mongoose";

/**
 * LE-032 — a request to a client (or another party) for evidence.
 *
 * A request may carry documents, questions, or only questions. When
 * `asSuggestion` is true the request is a draft for a supervisor to send, which
 * is what staff who cannot message clients create.
 */

export const REQUEST_CHANNELS = ["Email", "WhatsApp", "Client portal"] as const;
export type RequestChannel = (typeof REQUEST_CHANNELS)[number];

export const REQUEST_STATUSES = ["draft", "awaiting_approval", "sent", "complete"] as const;
export type EvidenceRequestStatus = (typeof REQUEST_STATUSES)[number];

export interface IEvidenceRequestItem {
  _id: Types.ObjectId;
  label: string;
  received: boolean;
  /** How many times the client has been chased for this line. */
  chaseCount: number;
  receivedAt?: Date;
  lastChasedAt?: Date;
}

export interface IEvidenceRequest extends Document {
  firmId: Types.ObjectId;
  clientId: Types.ObjectId;
  clientName?: string;
  /** Absent for "No particular matter". */
  matterId?: Types.ObjectId;
  matterName?: string;
  channel: RequestChannel;
  items: Types.DocumentArray<IEvidenceRequestItem>;
  questions: string[];
  /** ISO `YYYY-MM-DD`. */
  neededBy?: string;
  /** The exact wording that goes out. */
  message: string;
  status: EvidenceRequestStatus;
  /** True when this is a draft raised for a supervisor to send. */
  asSuggestion: boolean;
  requestedBy: Types.ObjectId;
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const evidenceRequestItemSchema = new Schema<IEvidenceRequestItem>({
  label: { type: String, required: true, trim: true },
  received: { type: Boolean, required: true, default: false },
  chaseCount: { type: Number, required: true, default: 0 },
  receivedAt: { type: Date },
  lastChasedAt: { type: Date },
});

const evidenceRequestSchema = new Schema<IEvidenceRequest>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    clientName: { type: String, trim: true },
    matterId: { type: Schema.Types.ObjectId, ref: "Matter", index: true },
    matterName: { type: String, trim: true },
    channel: { type: String, enum: REQUEST_CHANNELS, required: true, default: "Email" },
    items: { type: [evidenceRequestItemSchema], default: [] },
    questions: { type: [String], default: [] },
    neededBy: { type: String, trim: true },
    message: { type: String, required: true },
    status: {
      type: String,
      enum: REQUEST_STATUSES,
      required: true,
      default: "awaiting_approval",
      index: true,
    },
    asSuggestion: { type: Boolean, required: true, default: false },
    requestedBy: { type: Schema.Types.ObjectId, ref: "FirmMember", required: true },
    sentAt: { type: Date },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

evidenceRequestSchema.index({ firmId: 1, createdAt: -1 });

export const EvidenceRequest = model<IEvidenceRequest>("EvidenceRequest", evidenceRequestSchema);
