import { Schema, model, Document, Types } from "mongoose";

export type CommunicationChannel = "whatsapp" | "email" | "internal";

export interface IFirmMessage extends Document {
  firmId: Types.ObjectId;
  sender: string;
  senderId?: Types.ObjectId;
  recipient?: string;
  channel: CommunicationChannel;
  snippet: string;
  fullText?: string;
  matterId?: Types.ObjectId;
  matterName?: string;
  timeText: string;
  unread: boolean;
  isLead?: boolean;
  suggestedReply?: string;
  replyConfidence?: number;
  autoSendEnabled?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const FirmMessageSchema = new Schema<IFirmMessage>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    sender: { type: String, required: true, trim: true },
    senderId: { type: Schema.Types.ObjectId, ref: "FirmMember" },
    recipient: { type: String, trim: true },
    channel: {
      type: String,
      enum: ["whatsapp", "email", "internal"],
      default: "whatsapp",
      index: true,
    },
    snippet: { type: String, required: true },
    fullText: { type: String },
    matterId: { type: Schema.Types.ObjectId, ref: "Matter", index: true },
    matterName: { type: String },
    timeText: { type: String, default: "Just now" },
    unread: { type: Boolean, default: false },
    isLead: { type: Boolean, default: false },
    suggestedReply: { type: String },
    replyConfidence: { type: Number, default: 90 },
    autoSendEnabled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const FirmMessage = model<IFirmMessage>("FirmMessage", FirmMessageSchema);
