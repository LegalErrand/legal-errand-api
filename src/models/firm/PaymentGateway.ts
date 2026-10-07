import { Schema, model, Document, Types } from "mongoose";

/**
 * A firm's payment gateway setup.
 *
 * Named "gateway" rather than "provider" because models/firm/Payment.ts already
 * owns `PaymentProvider` — there it is the enum naming who took a payment, and
 * here this is the firm's configuration for taking one.
 *
 * ── Setup only, by design ────────────────────────────────────────────────────
 * Nothing in the API charges a card, creates a payment link or reads a
 * settlement. This records which gateway a firm intends to collect through and
 * the non-secret configuration that choice needs, so the live integration is a
 * later change that finds its configuration already in place.
 *
 * ── Why there is no secret key here ──────────────────────────────────────────
 * A gateway's secret key is the credential that moves money. This codebase has
 * no encryption-at-rest helper and no key management, so storing one would mean
 * a plaintext live credential in Mongo. The publishable key is enough for
 * everything the setup screen does, and the secret belongs with the work that
 * actually calls the provider, behind a secret store. The same reasoning is
 * already written down in Integration.ts.
 *
 * Settlement bank details are likewise absent: a firm configures those in the
 * provider's own dashboard, not here, so holding a copy would add risk and
 * a second source of truth without buying anything.
 */

export const PAYMENT_GATEWAYS = ["paystack", "flutterwave"] as const;
export type PaymentGatewayId = (typeof PAYMENT_GATEWAYS)[number];

/** A gateway's own sandbox, kept distinct so a test key cannot be read as live. */
export const PAYMENT_MODES = ["test", "live"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export interface IPaymentGateway extends Document {
  firmId: Types.ObjectId;
  provider: PaymentGatewayId;
  mode: PaymentMode;
  /** The publishable key. Not a secret — it is sent to the payer's browser. */
  publicKey: string;
  /** ISO 4217, e.g. ["NGN", "USD"]. Naira unless the firm says otherwise. */
  currencies: string[];
  /** The gateway that issues pay links. Exactly one per firm, or none. */
  isPrimary: boolean;
  /** Set up but switched off, so a firm can stage a gateway before using it. */
  enabled: boolean;
  updatedByName: string;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentGatewaySchema = new Schema<IPaymentGateway>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    provider: { type: String, enum: PAYMENT_GATEWAYS, required: true },
    mode: { type: String, enum: PAYMENT_MODES, required: true, default: "test" },
    publicKey: { type: String, required: true, trim: true },
    currencies: { type: [String], default: ["NGN"] },
    isPrimary: { type: Boolean, default: false },
    enabled: { type: Boolean, default: false },
    updatedByName: { type: String, required: true, trim: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// One row per gateway per firm; the screen edits in place rather than stacking.
PaymentGatewaySchema.index({ firmId: 1, provider: 1 }, { unique: true });

export const PaymentGateway = model<IPaymentGateway>("PaymentGateway", PaymentGatewaySchema);
