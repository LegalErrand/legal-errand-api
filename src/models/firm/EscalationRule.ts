import { Schema, model, Document, Types } from "mongoose";

export interface IEscalationRule extends Document {
  firmId: Types.ObjectId;
  trigger: string;
  goesTo: string;
  ifNoActionWithin: string;
  then: string;
  channel: string;
  isActive: boolean;
  liveAuditTrail?: Array<{
    timestamp: Date;
    timeText: string;
    matterId?: Types.ObjectId;
    matterName: string;
    title: string;
    description: string;
    level: number;
    actor: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const EscalationRuleSchema = new Schema<IEscalationRule>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    trigger: { type: String, required: true },
    goesTo: { type: String, required: true },
    ifNoActionWithin: { type: String, required: true },
    then: { type: String, required: true },
    channel: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    liveAuditTrail: [
      {
        timestamp: { type: Date, default: Date.now },
        timeText: { type: String, required: true },
        matterId: { type: Schema.Types.ObjectId, ref: "Matter" },
        matterName: { type: String, required: true },
        title: { type: String, required: true },
        description: { type: String, required: true },
        level: { type: Number, default: 1 },
        actor: { type: String, default: "AI" },
      },
    ],
  },
  { timestamps: true }
);

export const EscalationRule = model<IEscalationRule>("EscalationRule", EscalationRuleSchema);
