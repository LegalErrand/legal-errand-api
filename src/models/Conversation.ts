import mongoose, { Schema, Document } from "mongoose";

export interface IConversationDocument extends Document {
  userId: mongoose.Types.ObjectId;
  sessionId: string;
  title: string;
  messageCount: number;
  lastMessage: string;
  mode: "standard" | "socratic";
}

const ConversationSchema = new Schema<IConversationDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sessionId: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    messageCount: { type: Number, default: 1 },
    lastMessage: { type: String, default: "" },
    mode: { type: String, enum: ["standard", "socratic"], default: "standard" },
  },
  { timestamps: true }
);

ConversationSchema.index({ userId: 1, updatedAt: -1 });

export const Conversation = mongoose.model<IConversationDocument>(
  "Conversation",
  ConversationSchema
);
