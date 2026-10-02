import { Schema, model, Document, Types } from "mongoose";

/**
 * LE-011 finance — the firm's bank accounts, split by whose money is in them.
 *
 * This exists as its own model, rather than a register kind, because the split
 * is a rule and not a label: a client account holds money the firm is holding
 * on trust. It is never the firm's, it is never available to meet the firm's
 * costs, and it must never be totalled together with the office account. Giving
 * it a required `accountType` and no combined-balance helper is how that is
 * kept true in code rather than in a comment on a dashboard.
 */

export type OfficeAccountType = "office" | "client";

export interface IFirmOfficeAccount extends Document {
  firmId: Types.ObjectId;
  accountType: OfficeAccountType;
  /** e.g. "Main office account — GTBank". */
  name: string;
  bankName?: string;
  /** Last four digits only. A full account number is not needed to run an office. */
  accountNumberLast4?: string;
  balanceNaira: number;
  asOf: Date;
  createdByName: string;
  updatedByName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const FirmOfficeAccountSchema = new Schema<IFirmOfficeAccount>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    accountType: { type: String, enum: ["office", "client"], required: true, index: true },
    name: { type: String, required: true, trim: true },
    bankName: { type: String, trim: true },
    accountNumberLast4: { type: String, trim: true, maxlength: 4 },
    balanceNaira: { type: Number, default: 0 },
    asOf: { type: Date, default: Date.now },
    createdByName: { type: String, required: true, trim: true },
    updatedByName: { type: String, trim: true },
  },
  { timestamps: true }
);

/** True when this money is held on trust and is not the firm's to spend. */
export function isHeldOnTrust(account: IFirmOfficeAccount): boolean {
  return account.accountType === "client";
}

export const FirmOfficeAccount = model<IFirmOfficeAccount>(
  "FirmOfficeAccount",
  FirmOfficeAccountSchema
);
