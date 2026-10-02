import { Request, Response } from "express";
import crypto from "crypto";
import {
  Client,
  Firm,
  IntakeFormSchemaModel,
  IntakeSubmission,
  IntakeFormContent,
  IntakeQuestion,
  IIntakeFormSchema,
} from "../../models/firm";
import { sendSuccess, sendCreated, sendBadRequest, sendNotFound } from "../../utils/response";
import { firmIdOf } from "../../utils/tenancy";
import { defaultIntakeForm } from "../../utils/intake-defaults";

/** How long a saved-for-later form stays resumable. */
const RESUME_WINDOW_DAYS = 30;

const hashToken = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");

/** Only the editable form is ever sent; draft/published wrappers stay internal. */
const toContent = (content: IntakeFormContent): IntakeFormContent => ({
  firmName: content.firmName,
  firmLogoUrl: content.firmLogoUrl,
  brandColor: content.brandColor,
  steps: content.steps ?? [],
  practiceAreas: content.practiceAreas ?? [],
  consentText: content.consentText ?? "",
});

const readContent = (body: unknown): IntakeFormContent | null => {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as Partial<IntakeFormContent>;
  if (!Array.isArray(raw.steps) || !Array.isArray(raw.practiceAreas)) return null;
  return {
    firmName: typeof raw.firmName === "string" ? raw.firmName : undefined,
    firmLogoUrl: typeof raw.firmLogoUrl === "string" ? raw.firmLogoUrl : undefined,
    brandColor: typeof raw.brandColor === "string" ? raw.brandColor : undefined,
    steps: raw.steps,
    practiceAreas: raw.practiceAreas,
    consentText: typeof raw.consentText === "string" ? raw.consentText : "",
  };
};

/** Every question in the form, shared steps and practice-area follow-ups alike. */
const allQuestions = (content: IntakeFormContent): IntakeQuestion[] => [
  ...content.steps.flatMap((step) => step.questions ?? []),
  ...content.practiceAreas.flatMap((area) => area.questions ?? []),
];

const answersOf = (body: unknown): Record<string, string> => {
  if (typeof body !== "object" || body === null) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
  }
  return out;
};

// ─── Firm side (LE-017) — requires authenticateFirm ──────────────────────────

/**
 * The firm's own draft. Seeded from the shared default when the firm has none,
 * so the editor never opens empty.
 */
export const getIntakeForm = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);

    // Scoped by firmId, never by id from the request.
    let record: IIntakeFormSchema | null = await IntakeFormSchemaModel.findOne({ firmId });

    if (!record) {
      const firm = await Firm.findById(firmId).select("name");
      const seed = defaultIntakeForm(firm?.name);
      record = await IntakeFormSchemaModel.create({
        firmId,
        steps: seed.steps,
        practiceAreas: seed.practiceAreas,
        consentText: seed.consentText,
        draftVersion: seed,
      });
    }

    sendSuccess(res, toContent(record.draftVersion), "Intake form retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve intake form", error);
  }
};

/** Saves the draft. The live public form is untouched until publish. */
export const saveIntakeForm = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const content = readContent(req.body);
    if (!content) {
      sendBadRequest(res, "A form with steps and practiceAreas is required");
      return;
    }

    const record = await IntakeFormSchemaModel.findOneAndUpdate(
      { firmId },
      {
        $set: {
          steps: content.steps,
          practiceAreas: content.practiceAreas,
          consentText: content.consentText,
          draftVersion: content,
        },
        $setOnInsert: { firmId },
      },
      { new: true, upsert: true }
    );

    sendSuccess(res, toContent(record.draftVersion), "Intake form saved");
  } catch (error) {
    sendBadRequest(res, "Failed to save intake form", error);
  }
};

/** Copies the draft over the published version — the only way it goes live. */
export const publishIntakeForm = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);

    const record = await IntakeFormSchemaModel.findOne({ firmId });
    if (!record) {
      sendNotFound(res, "There is no intake form to publish yet");
      return;
    }

    const publishedAt = new Date();
    record.publishedVersion = toContent(record.draftVersion);
    record.publishedAt = publishedAt;
    await record.save();

    sendSuccess(res, { publishedAt: publishedAt.toISOString() }, "Intake form published");
  } catch (error) {
    sendBadRequest(res, "Failed to publish intake form", error);
  }
};

// ─── Public (LE-016) — NOT authenticated ─────────────────────────────────────
// A prospective client has no account, so the firm is resolved by its public
// slug. The slug identifies which firm's published form to serve; it is never
// used as, or alongside, a caller-supplied firmId on an authenticated route.

const firmBySlug = async (slug: string): Promise<{ id: string; name: string } | null> => {
  const firm = await Firm.findOne({ slug: String(slug).toLowerCase() }).select("name");
  return firm ? { id: String(firm._id), name: firm.name } : null;
};

/**
 * The published form only. An unpublished draft must never reach a prospective
 * client, so a firm that has not published yet reads as not found.
 */
export const getPublicIntakeForm = async (req: Request, res: Response): Promise<void> => {
  try {
    const firm = await firmBySlug(String(req.params.firmSlug));
    if (!firm) {
      sendNotFound(res, "That firm's intake form is not available");
      return;
    }

    const record = await IntakeFormSchemaModel.findOne({ firmId: firm.id }).select(
      "publishedVersion publishedAt"
    );

    if (!record?.publishedVersion) {
      sendNotFound(res, "That firm's intake form is not available");
      return;
    }

    sendSuccess(res, toContent(record.publishedVersion), "Intake form retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve intake form", error);
  }
};

/**
 * Submits the enquiry: a lead Client plus the submission itself. Consent is a
 * hard requirement — NDPA 2023 — so a false `consentGiven` is rejected rather
 * than recorded.
 */
export const submitPublicIntake = async (req: Request, res: Response): Promise<void> => {
  try {
    const firm = await firmBySlug(String(req.params.firmSlug));
    if (!firm) {
      sendNotFound(res, "That firm's intake form is not available");
      return;
    }

    const { answers, documentIds, consentGiven } = req.body as {
      answers?: unknown;
      documentIds?: unknown;
      consentGiven?: unknown;
    };

    if (consentGiven !== true) {
      sendBadRequest(res, "Consent is required before this enquiry can be sent");
      return;
    }

    const record = await IntakeFormSchemaModel.findOne({ firmId: firm.id }).select(
      "publishedVersion"
    );
    if (!record?.publishedVersion) {
      sendNotFound(res, "That firm's intake form is not available");
      return;
    }
    const published = toContent(record.publishedVersion);

    const given = answersOf(answers);
    const files = Array.isArray(documentIds)
      ? documentIds.filter((id): id is string => typeof id === "string")
      : [];

    const fullName = (given.full_name ?? "").trim();
    if (!fullName) {
      sendBadRequest(res, "Your full name is required");
      return;
    }

    // Urgency is decided here from the published form's own urgentWhen values,
    // never from a flag in the request.
    const urgentReasons = allQuestions(published)
      .filter((q) => q.urgentWhen && given[q.id] === q.urgentWhen)
      .map((q) => `${q.label}: ${given[q.id]}`);

    const practiceArea = given.practice_area?.trim() || "General";
    const reference = `IN-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

    const client = await Client.create({
      firmId: firm.id,
      name: fullName,
      type: "Individual",
      status: "lead",
      practiceArea,
      phone: given.phone,
      email: given.email,
      address: given.location,
      howFound: given.source,
      lastContactText: "Just now",
      urgencyNote: urgentReasons[0],
      intakeDetails: {
        channel: "web",
        receivedAt: new Date(),
        extractedFacts: Object.entries(given).map(([key, value]) => ({ key, value })),
        documents: files.map((id) => ({
          name: id,
          source: "Intake form upload",
          status: "pending" as const,
        })),
      },
    });

    await IntakeSubmission.create({
      firmId: firm.id,
      status: "submitted",
      reference,
      email: given.email,
      answers: given,
      documentIds: files,
      consentGiven: true,
      consentText: published.consentText,
      urgent: urgentReasons.length > 0,
      urgentReasons,
      clientId: client._id,
      submittedAt: new Date(),
    });

    sendCreated(res, { reference, firstName: fullName.split(" ")[0] }, "Enquiry sent");
  } catch (error) {
    sendBadRequest(res, "Failed to send this enquiry", error);
  }
};

/**
 * Saves a part-finished form and returns the token the resume link embeds. Only
 * the hash is stored, so the raw token exists in this response alone.
 */
export const savePublicIntake = async (req: Request, res: Response): Promise<void> => {
  try {
    const firm = await firmBySlug(String(req.params.firmSlug));
    if (!firm) {
      sendNotFound(res, "That firm's intake form is not available");
      return;
    }

    const { email, answers } = req.body as { email?: unknown; answers?: unknown };
    if (typeof email !== "string" || !email.includes("@")) {
      sendBadRequest(res, "A valid email address is required to save this form");
      return;
    }

    const resumeToken = crypto.randomBytes(24).toString("hex");
    const savedAt = new Date();

    await IntakeSubmission.create({
      firmId: firm.id,
      status: "saved",
      email,
      answers: answersOf(answers),
      consentGiven: false,
      urgent: false,
      resumeTokenHash: hashToken(resumeToken),
      resumeExpiresAt: new Date(savedAt.getTime() + RESUME_WINDOW_DAYS * 86400000),
      savedAt,
    });

    // Emailing the link belongs to the notification service, which is not wired
    // up here; the token is returned so the caller can build the link.
    sendCreated(res, { resumeToken }, "Form saved");
  } catch (error) {
    sendBadRequest(res, "Failed to save this form", error);
  }
};

/** Reads a saved form back. Scoped to the firm in the slug and to the token. */
export const resumePublicIntake = async (req: Request, res: Response): Promise<void> => {
  try {
    const firm = await firmBySlug(String(req.params.firmSlug));
    if (!firm) {
      sendNotFound(res, "That saved form could not be found");
      return;
    }

    const submission = await IntakeSubmission.findOne({
      firmId: firm.id,
      status: "saved",
      resumeTokenHash: hashToken(String(req.params.resumeToken)),
    }).select("answers documentIds savedAt resumeExpiresAt");

    if (!submission) {
      sendNotFound(res, "That saved form could not be found");
      return;
    }

    if (submission.resumeExpiresAt && submission.resumeExpiresAt.getTime() < Date.now()) {
      sendBadRequest(res, "That link has expired — please start the form again");
      return;
    }

    sendSuccess(
      res,
      {
        answers: submission.answers,
        documentIds: submission.documentIds,
        savedAt: (submission.savedAt ?? submission.createdAt).toISOString(),
      },
      "Saved form retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve that saved form", error);
  }
};
