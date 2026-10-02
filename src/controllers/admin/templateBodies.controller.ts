import { Request, Response } from "express";
import { AdminRequest } from "../../types";
import { BuiltInTemplateBody } from "../../models/firm";
import { adminNameFor } from "../../services/firm/audit.service";
import { sendSuccess, sendBadRequest, sendNotFound } from "../../utils/response";

/**
 * The 39 built-in template bodies, maintained by LegalErrand staff.
 *
 * These are documents Nigerian firms file at court, so nothing here generates
 * or guesses text — a body only ever arrives because a person supplied it.
 */

/** GET /admin/firms/template-bodies → every body we hold, by template id. */
export const listTemplateBodies = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await BuiltInTemplateBody.find().sort({ templateId: 1 }).lean();
    sendSuccess(
      res,
      rows.map((r) => ({
        templateId: r.templateId,
        body: r.body,
        characters: r.body.length,
        updatedByName: r.updatedByName ?? null,
        updatedAt: r.updatedAt,
      })),
      "Template bodies retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve template bodies", error);
  }
};

/** PUT /admin/firms/template-bodies/:templateId — { body } */
export const upsertTemplateBody = async (req: Request, res: Response): Promise<void> => {
  try {
    const { templateId } = req.params;
    const { body } = req.body as { body?: string };

    if (!body?.trim()) {
      sendBadRequest(res, "The template body cannot be empty");
      return;
    }

    const updatedByName = await adminNameFor((req as AdminRequest).admin);

    const row = await BuiltInTemplateBody.findOneAndUpdate(
      { templateId },
      { $set: { body, updatedByName } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    sendSuccess(
      res,
      {
        templateId: row.templateId,
        characters: row.body.length,
        updatedByName: row.updatedByName ?? null,
        updatedAt: row.updatedAt,
      },
      "Template body saved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to save the template body", error);
  }
};

/** DELETE /admin/firms/template-bodies/:templateId */
export const deleteTemplateBody = async (req: Request, res: Response): Promise<void> => {
  try {
    const { templateId } = req.params;
    const row = await BuiltInTemplateBody.findOneAndDelete({ templateId });
    if (!row) {
      sendNotFound(res, "No body is held for that template");
      return;
    }
    sendSuccess(res, { templateId }, "Template body removed");
  } catch (error) {
    sendBadRequest(res, "Failed to remove the template body", error);
  }
};

/**
 * GET /firm/templates/bodies — the firm app's read side.
 *
 * Authenticated as a firm member rather than an admin: every firm reads the
 * same bodies, so there is nothing firm-specific to scope, but an unauthenticated
 * caller has no business with the product's document library.
 */
export const getTemplateBodiesForFirm = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await BuiltInTemplateBody.find().select("templateId body").lean();
    const bodies: Record<string, string> = {};
    for (const r of rows) bodies[r.templateId] = r.body;
    sendSuccess(res, bodies, "Template bodies retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve template bodies", error);
  }
};
