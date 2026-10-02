import { Schema, model, Document } from "mongoose";

/**
 * The text of one of the 39 templates LegalErrand ships.
 *
 * Deliberately **not** firm-scoped: these are the product's own documents,
 * uploaded once by LegalErrand staff and read by every firm. A firm's own
 * uploads are FirmTemplate, which is firm-scoped.
 *
 * The catalogue's metadata — name, group, whether it opens on a letterhead or
 * a court heading — lives in the firm app, because that is what renders it.
 * This holds only the body, keyed by the same id.
 */
export interface IBuiltInTemplateBody extends Document {
  /** Matches FirmTemplate's id in the firm app's catalogue, e.g. "tenancy-agreement". */
  templateId: string;
  body: string;
  /** Who last supplied it, for the record — these are legal documents. */
  updatedByName?: string;
  updatedAt: Date;
  createdAt: Date;
}

const BuiltInTemplateBodySchema = new Schema<IBuiltInTemplateBody>(
  {
    templateId: { type: String, required: true, unique: true, index: true, trim: true },
    body: { type: String, required: true },
    updatedByName: { type: String, trim: true },
  },
  { timestamps: true }
);

export const BuiltInTemplateBody = model<IBuiltInTemplateBody>(
  "BuiltInTemplateBody",
  BuiltInTemplateBodySchema
);
