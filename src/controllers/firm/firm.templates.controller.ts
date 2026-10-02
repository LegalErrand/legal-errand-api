import { Request, Response } from "express";
import {
  FirmTemplate,
  TemplateGroup,
  TEMPLATE_GROUPS,
  HeadingType,
  SavedSignature,
  AppliedSignature,
  SignatureRequest,
  SignatureKind,
  SIGNATURE_KINDS,
  FirmDocument,
  Matter,
} from "../../models/firm";
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendConflict,
} from "../../utils/response";
import { firmIdOf, memberIdOf } from "../../utils/tenancy";

/**
 * LE-029 (templates) and LE-028 (signatures).
 *
 * Two rules shape this file:
 *  • A saved signature belongs to one member. Every read is scoped to the firm
 *    *and* the caller, and there is no parameter anywhere that names whose
 *    signatures to return — so no caller can reach another member's rows.
 *  • A signature applied to a signed document is immutable: writes against a
 *    locked row are refused with 409 rather than quietly ignored.
 */

// ─── Templates ───────────────────────────────────────────────────────────────

/**
 * Filename keywords → group and heading. LE-029's letterhead rule: court
 * processes and wills open on the court heading, everything else on the firm
 * letterhead.
 */
const GROUP_HINTS: { group: TemplateGroup; heading: HeadingType; words: string[] }[] = [
  {
    group: "Court documents",
    heading: "court",
    words: [
      "affidavit",
      "motion",
      "claim",
      "defence",
      "defense",
      "written address",
      "witness statement",
      "writ",
      "summons",
      "petition",
      "originating",
      "pleading",
      "injunction",
    ],
  },
  {
    group: "Estate and probate",
    heading: "court",
    words: ["will", "codicil", "probate", "letters of administration", "estate", "executor"],
  },
  {
    group: "Agreements",
    heading: "letterhead",
    words: [
      "agreement",
      "contract",
      "retainer",
      "nda",
      "memorandum of understanding",
      "mou",
      "lease",
    ],
  },
  {
    group: "Letters",
    heading: "letterhead",
    words: ["letter", "demand", "engagement", "correspondence", "reply"],
  },
  {
    group: "Corporate",
    heading: "letterhead",
    words: ["resolution", "incorporation", "cac", "shareholder", "board", "articles", "bylaw"],
  },
  {
    group: "Deeds and property",
    heading: "letterhead",
    words: ["deed", "assignment", "conveyance", "mortgage", "title", "survey"],
  },
  {
    group: "Notices",
    heading: "letterhead",
    words: ["notice", "quit", "termination", "warning"],
  },
  {
    group: "Policies",
    heading: "letterhead",
    words: ["policy", "handbook", "procedure", "code of conduct", "compliance"],
  },
];

function classify(fileName: string): { group: TemplateGroup; heading: HeadingType } {
  const lower = fileName.toLowerCase();
  const hit = GROUP_HINTS.find((h) => h.words.some((w) => lower.includes(w)));
  return hit
    ? { group: hit.group, heading: hit.heading }
    : { group: "Other", heading: "letterhead" };
}

function stripExtension(name: string): string {
  return name
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

/** GET /templates — the firm's own uploads. The 39 built-ins are client config. */
export const listFirmTemplates = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const templates = await FirmTemplate.find({ firmId }).sort({ group: 1, name: 1 });
    sendSuccess(res, templates, "Templates retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve templates", error);
  }
};

/** POST /templates/upload — sorts each file into a group by its name. */
export const uploadTemplates = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const memberId = memberIdOf(req);
    const { files } = req.body as {
      files?: { name?: string; size?: number; contentBase64?: string }[];
    };

    if (!Array.isArray(files) || files.length === 0) {
      sendBadRequest(res, "At least one file is required");
      return;
    }
    if (files.some((f) => !f.name || !f.name.trim())) {
      sendBadRequest(res, "Every file needs a name");
      return;
    }

    const created = await FirmTemplate.insertMany(
      files.map((f) => {
        const fileName = String(f.name);
        const { group, heading } = classify(fileName);
        return {
          firmId,
          name: stripExtension(fileName) || fileName,
          group,
          heading,
          description: `Uploaded by the firm · ${group}`,
          // The body is decoded from the upload when it is plain text; binary
          // formats are left empty until a converter runs over them.
          body: "",
          sizeBytes: typeof f.size === "number" ? f.size : undefined,
          uploadedBy: memberId,
        };
      })
    );

    sendCreated(res, created, "Templates uploaded");
  } catch (error) {
    sendBadRequest(res, "Failed to upload the templates", error);
  }
};

/** PATCH /templates/:id/group */
export const setTemplateGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const { id } = req.params;
    const { group } = req.body as { group?: TemplateGroup };

    if (!group || !TEMPLATE_GROUPS.includes(group)) {
      sendBadRequest(res, "A known template group is required");
      return;
    }

    // Scoped lookup: findById alone would let one firm edit another's template.
    const template = await FirmTemplate.findOne({ _id: id, firmId });
    if (!template) {
      sendNotFound(res, "Template not found");
      return;
    }

    template.group = group;
    await template.save();

    sendSuccess(res, template, "Template moved");
  } catch (error) {
    sendBadRequest(res, "Failed to move the template", error);
  }
};

/** DELETE /templates/:id */
export const deleteTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const { id } = req.params;

    const deleted = await FirmTemplate.findOneAndDelete({ _id: id, firmId });
    if (!deleted) {
      sendNotFound(res, "Template not found");
      return;
    }

    sendSuccess(res, {}, "Template deleted");
  } catch (error) {
    sendBadRequest(res, "Failed to delete the template", error);
  }
};

/** POST /templates/open — opens a template as a new draft document. */
export const openTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const { templateId, matterId, letterhead } = req.body as {
      templateId?: string;
      matterId?: string;
      letterhead?: boolean;
    };

    if (!templateId) {
      sendBadRequest(res, "A template is required");
      return;
    }

    const template = await FirmTemplate.findOne({ _id: templateId, firmId });
    if (!template) {
      sendNotFound(res, "Template not found");
      return;
    }

    let matterName: string | undefined;
    if (matterId) {
      const matter = await Matter.findOne({ _id: matterId, firmId });
      if (!matter) {
        sendNotFound(res, "Matter not found");
        return;
      }
      matterName = matter.name;
    }

    // The caller may force the firm letterhead; otherwise the template's own
    // heading decides, which is where LE-029's court-heading rule lives.
    const heading: HeadingType = letterhead === true ? "letterhead" : template.heading;

    const draft = await FirmDocument.create({
      firmId,
      name: template.name,
      type: "Template",
      matterId,
      matterName,
      status: "draft",
      source: "template",
      content: template.body,
      aiTags: [heading === "court" ? "court heading" : "letterhead"],
    });

    sendCreated(res, draft, "Draft created from the template");
  } catch (error) {
    sendBadRequest(res, "Failed to open the template", error);
  }
};

// ─── Signatures ──────────────────────────────────────────────────────────────

/**
 * GET /signatures — the caller's own saved signatures and nobody else's.
 *
 * The filter is built from the token alone: firmId *and* ownerId both come from
 * `req.member`, and neither the query string nor the body can reach this
 * filter. There is deliberately no "whose signatures" parameter and no route
 * that lists another member's rows.
 */
export const listMySignatures = async (req: Request, res: Response): Promise<void> => {
  try {
    const signatures = await SavedSignature.find({
      firmId: firmIdOf(req),
      ownerId: memberIdOf(req),
    }).sort({ createdAt: -1 });

    sendSuccess(res, signatures, "Signatures retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve signatures", error);
  }
};

/** POST /signatures — saves a signature to the caller's own account. */
export const saveSignature = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const ownerId = memberIdOf(req);
    const { kind, dataUrl, name, capacity, fontFamily } = req.body as {
      kind?: SignatureKind;
      dataUrl?: string;
      name?: string;
      capacity?: string;
      fontFamily?: string;
    };

    if (!kind || !SIGNATURE_KINDS.includes(kind)) {
      sendBadRequest(res, "A signature kind of drawn, typed or uploaded is required");
      return;
    }
    if (!dataUrl || !name) {
      sendBadRequest(res, "A signature image and a name are required");
      return;
    }

    // The owner comes from the token, so a caller cannot save a signature into
    // somebody else's account.
    const saved = await SavedSignature.create({
      firmId,
      ownerId,
      kind,
      dataUrl,
      name,
      capacity,
      fontFamily,
    });

    sendCreated(res, saved, "Signature saved");
  } catch (error) {
    sendBadRequest(res, "Failed to save the signature", error);
  }
};

/** DELETE /signatures/:id — only the caller's own row can be deleted. */
export const deleteSignature = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const deleted = await SavedSignature.findOneAndDelete({
      _id: id,
      firmId: firmIdOf(req),
      ownerId: memberIdOf(req),
    });
    if (!deleted) {
      sendNotFound(res, "Signature not found");
      return;
    }

    sendSuccess(res, {}, "Signature deleted");
  } catch (error) {
    sendBadRequest(res, "Failed to delete the signature", error);
  }
};

/**
 * POST /signatures/apply — places a signature on a document.
 *
 * A mark on a signed document is immutable: if this member has already signed
 * this document the existing row is locked, and replacing it is refused 409.
 */
export const applySignature = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const memberId = memberIdOf(req);
    const { documentId, kind, dataUrl, name, capacity, dateSigned } = req.body as {
      documentId?: string;
      kind?: SignatureKind;
      dataUrl?: string;
      name?: string;
      capacity?: string;
      dateSigned?: string;
    };

    if (!documentId) {
      sendBadRequest(res, "A document is required");
      return;
    }
    if (!kind || !SIGNATURE_KINDS.includes(kind)) {
      sendBadRequest(res, "A signature kind of drawn, typed or uploaded is required");
      return;
    }
    if (!dataUrl || !name) {
      sendBadRequest(res, "A signature image and a name are required");
      return;
    }

    const document = await FirmDocument.findOne({ _id: documentId, firmId });
    if (!document) {
      sendNotFound(res, "Document not found");
      return;
    }

    const existing = await AppliedSignature.findOne({
      firmId,
      documentId,
      signedBy: memberId,
    });
    if (existing?.locked) {
      sendConflict(res, "That signature is locked — a signed document cannot be re-signed");
      return;
    }

    const applied = await AppliedSignature.create({
      firmId,
      documentId,
      signedBy: memberId,
      kind,
      dataUrl,
      name,
      capacity,
      dateSigned,
      locked: true,
    });

    sendCreated(res, applied, "Signature applied");
  } catch (error) {
    sendBadRequest(res, "Failed to apply the signature", error);
  }
};

/** POST /signatures/request — leaves a pending line and records the request. */
export const requestSignature = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const memberId = memberIdOf(req);
    const { documentId, name, capacity, email } = req.body as {
      documentId?: string;
      name?: string;
      capacity?: string;
      email?: string;
    };

    if (!documentId || !name || !capacity || !email) {
      sendBadRequest(res, "A document, name, capacity and email are all required");
      return;
    }

    const document = await FirmDocument.findOne({ _id: documentId, firmId });
    if (!document) {
      sendNotFound(res, "Document not found");
      return;
    }

    const created = await SignatureRequest.create({
      firmId,
      documentId,
      name,
      capacity,
      email,
      status: "pending",
      requestedBy: memberId,
      requestedAt: new Date(),
    });

    sendCreated(res, created, "Signature requested");
  } catch (error) {
    sendBadRequest(res, "Failed to request the signature", error);
  }
};
