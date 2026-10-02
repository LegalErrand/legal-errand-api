import { Schema, model, Document, Types } from "mongoose";

export const CONNECTION_STATUSES = ["connected", "reconnect", "error"] as const;

export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

/**
 * A firm's live connection to one provider (LE-044).
 *
 * The provider catalogue itself is static config in the front end; this is only
 * the firm's own state. Provider credentials are NOT modelled here: no read
 * endpoint may ever return a secret, so until a real OAuth handshake exists
 * there is nothing secret to keep. When one is added, the tokens belong in a
 * separate collection that no serialiser touches.
 */
export interface IIntegration extends Document {
  firmId: Types.ObjectId;
  /** Catalogue id, e.g. "google-meet". */
  providerId: string;
  status: ConnectionStatus;
  /** The account it runs under, e.g. "chambers@firm.ng". */
  account: string;
  /** Whole firm, or just the member who connected it. */
  scope: "firm" | "person";
  /** Set when `scope` is "person" — the owning member. */
  ownerId?: Types.ObjectId;
  connectedByName: string;
  connectedAt: Date;
  /** Keyed by the catalogue's `IntegrationSetting.key`. */
  settings: Map<string, boolean>;
  /** Shown when status is "error" or "reconnect". */
  message?: string;
  createdAt: Date;
  updatedAt: Date;
}

const IntegrationSchema = new Schema<IIntegration>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    providerId: { type: String, required: true, trim: true, index: true },
    status: { type: String, enum: CONNECTION_STATUSES, required: true, default: "connected" },
    account: { type: String, required: true, trim: true },
    scope: { type: String, enum: ["firm", "person"], required: true, default: "firm" },
    ownerId: { type: Schema.Types.ObjectId, ref: "FirmMember" },
    connectedByName: { type: String, required: true, trim: true },
    connectedAt: { type: Date, required: true, default: Date.now },
    settings: { type: Map, of: Boolean, default: new Map<string, boolean>() },
    message: { type: String, trim: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// A firm connects any provider once; a per-person connection is still one row
// per provider per firm, owned by whoever connected it.
IntegrationSchema.index({ firmId: 1, providerId: 1 }, { unique: true });

export const Integration = model<IIntegration>("Integration", IntegrationSchema);

/**
 * Integration preferences that belong to the firm rather than to one provider.
 * Kept out of `Firm` so the settings screens being reworked concurrently are
 * untouched.
 */
export interface IFirmIntegrationSettings extends Document {
  firmId: Types.ObjectId;
  /** Provider used for new client meetings, or null when none is chosen. */
  defaultVideoProviderId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const FirmIntegrationSettingsSchema = new Schema<IFirmIntegrationSettings>(
  {
    firmId: {
      type: Schema.Types.ObjectId,
      ref: "Firm",
      required: true,
      index: true,
      unique: true,
    },
    defaultVideoProviderId: { type: String, default: null },
  },
  { timestamps: true }
);

export const FirmIntegrationSettings = model<IFirmIntegrationSettings>(
  "FirmIntegrationSettings",
  FirmIntegrationSettingsSchema
);
