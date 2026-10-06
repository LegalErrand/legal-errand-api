import { Schema, model, Document, Types } from "mongoose";

/**
 * What a bulk move changed, kept just long enough to reverse it (LE-024).
 *
 * This was an in-process Map. That worked on one box and nowhere else: an undo
 * would miss behind a load balancer whenever the second request landed on a
 * different instance, and a deploy or a crash between the move and the undo
 * lost the window silently — the move had happened, the way back had not.
 *
 * Mongo's TTL monitor sweeps expired rows, so there is no prune to call and
 * nothing accumulates. It runs about once a minute, which means a row can
 * outlive `expireAfterSeconds` briefly; that is fine here, because `undoUntil`
 * is what decides whether an undo is still allowed, not the row's existence.
 */
/** What was moved. Kept in step with the controller's own union. */
export type BulkMoveItemType = "matter" | "document";

export interface IBulkMoveLedger extends Document {
  firmId: Types.ObjectId;
  /** Who moved them — only they may undo it. */
  memberId: Types.ObjectId;
  itemType: BulkMoveItemType;
  /** Where each item sat before, which is all an undo needs. */
  previous: Array<{
    id: string;
    matterId?: string;
    matterName?: string;
    folder?: string;
    clientId?: string;
    clientName?: string;
    label: string;
  }>;
  destinationLabel: string;
  undone: boolean;
  undoneAt?: Date;
  /** After this, the move stands. */
  undoUntil: Date;
  at: Date;
}

const previousSchema = new Schema(
  {
    id: { type: String, required: true },
    matterId: { type: String },
    matterName: { type: String },
    folder: { type: String },
    clientId: { type: String },
    clientName: { type: String },
    label: { type: String, required: true },
  },
  { _id: false }
);

const bulkMoveLedgerSchema = new Schema<IBulkMoveLedger>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: "FirmMember", required: true },
    itemType: { type: String, enum: ["matter", "document"], required: true },
    previous: { type: [previousSchema], required: true },
    destinationLabel: { type: String, required: true },
    undone: { type: Boolean, required: true, default: false },
    undoneAt: { type: Date },
    undoUntil: { type: Date, required: true },
    at: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false }
);

// Swept by Mongo a minute after the row was written — comfortably past the
// undo window, and long enough that a request at the edge of it still finds
// the row and gets a clear "too late" rather than "not found".
bulkMoveLedgerSchema.index({ at: 1 }, { expireAfterSeconds: 120 });

export const BulkMoveLedger = model<IBulkMoveLedger>("BulkMoveLedger", bulkMoveLedgerSchema);
