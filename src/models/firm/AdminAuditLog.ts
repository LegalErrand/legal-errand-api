import { Schema, model, Document, Types } from "mongoose";

/**
 * Everything an admin or the system did to a firm.
 *
 * Append-only. There is no endpoint that edits or deletes a row, and there must
 * never be one: the value of this collection is that nobody can tidy it up
 * afterwards. If a row is wrong, the fix is another row saying so.
 *
 * `adminName` and `firmName` are copied in rather than joined at read time, on
 * purpose. An admin can be renamed or removed and a firm can be deleted; the
 * record of what was done, by whom, to whom, has to survive all three.
 */
export interface IAdminAuditLog extends Document {
  /** Absent when the system acted on its own — a scheduled retry, say. */
  adminId?: Types.ObjectId;
  /** Who it was at the time, kept verbatim. "System" when nobody. */
  adminName: string;
  /** What was done, in plain words: "Changed plan practice → firm". */
  action: string;
  firmId?: Types.ObjectId;
  firmName?: string;
  /** Anything worth keeping that does not belong in the sentence. */
  detail?: Record<string, unknown>;
  at: Date;
  createdAt: Date;
}

const adminAuditLogSchema = new Schema<IAdminAuditLog>(
  {
    adminId: { type: Schema.Types.ObjectId, ref: "Admin", index: true },
    adminName: { type: String, required: true, trim: true },
    action: { type: String, required: true, trim: true },
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", index: true },
    firmName: { type: String, trim: true },
    detail: { type: Schema.Types.Mixed },
    at: { type: Date, required: true, default: Date.now, index: true },
  },
  // No updatedAt: a row that is never updated should not pretend it might be.
  { timestamps: { createdAt: true, updatedAt: false } }
);

adminAuditLogSchema.index({ at: -1 });
adminAuditLogSchema.index({ firmId: 1, at: -1 });

export const AdminAuditLog = model<IAdminAuditLog>("AdminAuditLog", adminAuditLogSchema);
