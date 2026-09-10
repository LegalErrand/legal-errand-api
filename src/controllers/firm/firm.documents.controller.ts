import { Request, Response } from "express";
import { FirmDocument, Matter } from "../../models/firm";
import { sendSuccess, sendCreated, sendBadRequest, sendNotFound } from "../../utils/response";
import { deepseekService } from "../../services/ai/deepseek.service";

export const getDocuments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, type, matterId, search } = req.query;
    const filter: Record<string, unknown> = {};

    if (status && status !== "all") filter.status = status;
    if (type && type !== "all") filter.type = type;
    if (matterId) filter.matterId = matterId;
    if (search) filter.name = { $regex: String(search), $options: "i" };

    const documents = await FirmDocument.find(filter).sort({ updatedAt: -1 });
    sendSuccess(res, documents, "Documents retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve documents", error);
  }
};

export const generateDocumentDraft = async (req: Request, res: Response): Promise<void> => {
  try {
    const { matterId, templateType, instructions } = req.body as {
      matterId?: string;
      templateType?: string;
      instructions?: string;
    };

    if (!templateType) {
      sendBadRequest(res, "templateType is required");
      return;
    }

    const matter = matterId ? await Matter.findById(matterId) : null;

    const systemContext = [
      "You are drafting a legal document for a Nigerian law firm, for partner review.",
      matter
        ? `The matter is "${matter.name}" for client ${matter.clientName ?? "the client"} (${matter.type}).`
        : "No matter has been linked, so keep party details as clearly marked placeholders.",
      instructions ? `Fee earner instructions: ${instructions}` : "",
      "Produce the full document body only — no preamble, no commentary, no markdown.",
      "Use [SQUARE BRACKETS] for any detail you do not know rather than inventing it.",
      "Apply Nigerian law and standard Nigerian drafting conventions.",
    ]
      .filter(Boolean)
      .join(" ");

    const content = await deepseekService.chatWithHistory(
      [
        {
          role: "user",
          content: `Draft a ${templateType} in full.`,
          timestamp: new Date(),
        },
      ],
      systemContext,
      3000
    );

    const doc = await FirmDocument.create({
      firmId: matter?.firmId,
      name: `${templateType} — ${matter?.clientName || "Untitled"}.docx`,
      type: templateType,
      matterId: matter?._id,
      matterName: matter?.name,
      status: "in_review",
      source: "ai_draft",
      content,
    });

    sendCreated(res, doc, "Draft document generated");
  } catch (error) {
    sendBadRequest(res, "Failed to generate document draft", error);
  }
};

export const reviewAndChat = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { message } = req.body as { message?: string };

    const doc = await FirmDocument.findById(id);
    if (!doc) {
      sendNotFound(res, "Document not found");
      return;
    }

    const question = message?.trim() || "Summarise the key risks in this document.";

    const systemContext = [
      "You are reviewing a specific document on behalf of a qualified fee earner at a Nigerian law firm.",
      `The document is titled "${doc.name}" (type: ${doc.type}).`,
      doc.content
        ? `Document text follows between triple dashes:\n---\n${doc.content.slice(0, 6000)}\n---`
        : "",
      "Answer strictly about this document. Cite the clause or section you are referring to.",
      "If the document text is unavailable or does not cover the question, say so plainly rather than inventing clauses.",
      "Keep responses concise — 2 to 4 short paragraphs.",
      "Write in plain prose only: no markdown, no asterisks, no headings, no bullet lists.",
    ]
      .filter(Boolean)
      .join(" ");

    const reply = await deepseekService.chatWithHistory(
      [{ role: "user", content: question, timestamp: new Date() }],
      systemContext
    );

    sendSuccess(
      res,
      {
        reply,
        chips: ["Draft a redline", "Show related precedent", "Save note to matter"],
        riskScore: doc.riskScore ?? null,
      },
      "AI review insight generated"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to generate AI review analysis", error);
  }
};
