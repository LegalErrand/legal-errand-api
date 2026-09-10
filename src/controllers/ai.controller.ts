import { Response } from "express";
import { AuthRequest, ConversationMessage } from "../types";
import { deepseekService } from "../services/ai/deepseek.service";
import { socraticService } from "../services/ai/socratic.service";
import { redisService } from "../services/cache/redis.service";
import { Progress } from "../models/Progress";
import { Note } from "../models/Note";
import { CaseExplanation } from "../models/CaseExplanation";
import { Conversation } from "../models/Conversation";
import type { IConversationMessage } from "../models/Conversation";
import { LibraryDocument } from "../models/Document";
import { s3Client, S3_BUCKET } from "../config/s3";
import { AI_LIMITS } from "../config/deepseek";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendError,
} from "../utils/response";
import { v4 as uuidv4 } from "uuid";

function toStoredMessages(history: ConversationMessage[]): IConversationMessage[] {
  return history
    .filter((m): m is ConversationMessage & { role: "user" | "assistant" } => m.role !== "system")
    .map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp),
    }));
}

async function fetchDocumentText(s3Key: string): Promise<string> {
  // Binary PDFs cannot be read as UTF-8 without a parser — skip extraction.
  if (/\.pdf$/i.test(s3Key)) {
    return "";
  }

  const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key });
  const response = await s3Client.send(command);
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf-8").slice(0, 15000);
  // Heuristic: if most bytes are non-printable, this is not usable judgment text.
  const sample = text.slice(0, 500);
  const nonPrintable = Array.from(sample).filter((ch) => {
    const code = ch.charCodeAt(0);
    return !(code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126));
  }).length;
  if (sample.length > 40 && nonPrintable / sample.length > 0.3) {
    return "";
  }
  return text;
}

const today = () => new Date().toISOString().split("T")[0];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type CaseBrief = {
  citation: string;
  facts: string;
  issue: string;
  holding: string;
  reasoning: string;
  significance: string;
  relatedCases: string[];
  practiceQuestions: string[];
};

function asBriefString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
}

function asBriefStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        return asBriefString(obj.citation ?? obj.name ?? obj.title ?? obj.question ?? obj.text);
      }
      return asBriefString(item);
    })
    .filter(Boolean);
}

/** Map common model key variants into our CaseExplanation schema. */
function normalizeCaseBrief(raw: unknown): CaseBrief {
  const obj =
    raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const nested =
    obj.analysis && typeof obj.analysis === "object"
      ? (obj.analysis as Record<string, unknown>)
      : obj;

  return {
    citation: asBriefString(nested.citation ?? nested.Citation ?? nested.caseName ?? obj.citation),
    facts: asBriefString(nested.facts ?? nested.Facts ?? nested.fact ?? nested.summary),
    issue: asBriefString(nested.issue ?? nested.Issue ?? nested.issues ?? nested.legalIssue),
    holding: asBriefString(
      nested.holding ?? nested.Holding ?? nested.decision ?? nested.judgment ?? nested.ratio
    ),
    reasoning: asBriefString(nested.reasoning ?? nested.Reasoning ?? nested.ratioDecidendi),
    significance: asBriefString(
      nested.significance ?? nested.Significance ?? nested.importance ?? nested.whyItMatters
    ),
    relatedCases: asBriefStringArray(
      nested.relatedCases ?? nested.RelatedCases ?? nested.related_cases ?? nested.authorities
    ),
    practiceQuestions: asBriefStringArray(
      nested.practiceQuestions ??
        nested.PracticeQuestions ??
        nested.practice_questions ??
        nested.questions
    ),
  };
}

function isCaseBriefComplete(brief: CaseBrief): boolean {
  return Boolean(brief.facts && brief.issue && brief.holding);
}

/** Short party/citation queries like "Madukolu v. Nkemdilim (1962)". */
function looksLikeCitationQuery(input: string): boolean {
  const t = input.trim();
  if (!t || t.length > 400) return false;
  return (
    /\bv\.?\s+/i.test(t) ||
    /\bvs\.?\s+/i.test(t) ||
    /\(\d{4}\)/.test(t) ||
    /\[\d{4}\]/.test(t) ||
    /\b(NWLR|All\s?NLR|SCNLR|WRN|NCLR)\b/i.test(t)
  );
}

async function findLibraryCaseByQuery(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const escaped = escapeRegex(trimmed);
  let doc = await LibraryDocument.findOne({
    $or: [{ "metadata.citation": new RegExp(escaped, "i") }, { title: new RegExp(escaped, "i") }],
  }).lean();

  if (doc) return doc;

  const parties = trimmed
    .split(/\s+v\.?\s+|\s+vs\.?\s+/i)
    .map((part) =>
      part
        .replace(/\(\d{4}\).*$/, "")
        .replace(/\[\d{4}\].*$/, "")
        .trim()
    )
    .filter((part) => part.length > 2);

  if (parties.length >= 2) {
    doc = await LibraryDocument.findOne({
      $and: parties.slice(0, 2).map((party) => {
        const re = new RegExp(escapeRegex(party), "i");
        return { $or: [{ title: re }, { "metadata.citation": re }] };
      }),
    }).lean();
  }

  return doc;
}

function buildCaseExplainerPrompt(caseText: string, mode: "full_text" | "citation"): string {
  if (mode === "citation") {
    return `You are a senior Nigerian law lecturer. The student provided only a case name and/or citation (no full judgment text). Produce a study brief for that case from established Nigerian legal knowledge.

Return a JSON object in exactly this structure:
{
  "citation": "<Best standard citation for the case, including year and report where known>",
  "facts": "<Plain-English summary of the material facts>",
  "issue": "<The precise legal question(s) the court decided>",
  "holding": "<The court's decision and who prevailed>",
  "reasoning": "<The ratio and key legal principles applied>",
  "significance": "<Why the case matters for Nigerian law students. Start with: 'Based on established case law knowledge (full judgment text was not supplied).'>",
  "relatedCases": ["<Up to 5 closely related Nigerian authorities you are confident are real>"],
  "practiceQuestions": ["<3 exam-style questions a law student could answer from this brief>"]
}

IMPORTANT RULES:
- Common-law authorities that Nigerian courts still apply (e.g. Donoghue v Stevenson) are in scope — analyse them normally and note their reception in Nigerian law in significance.
- Only refuse if you are not confident the named case is a real authority. If unsure, set facts/issue/holding/reasoning to "Not enough confident knowledge for this citation — paste the judgment text or select it from the Library." and leave relatedCases empty.
- Do not invent report citations, judge names, or statutes.
- Return ONLY valid JSON. No markdown. No commentary outside the JSON.

CASE NAME / CITATION:
${caseText}`;
  }

  return `You are a senior Nigerian law lecturer. Analyze ONLY the case text provided below — do not invent or assume any facts not found in the text. Return a JSON object in exactly this structure:

{
  "citation": "<Extract the exact legal citation from the text, e.g. 'Donoghue v Stevenson [1932] AC 562'. If not found, write 'Citation not available'.>",
  "facts": "<Plain-English summary of what happened — who the parties are, what dispute arose, and what happened procedurally. Only facts explicitly stated in the text.>",
  "issue": "<The precise legal question(s) the court had to decide. Quote from the text where possible.>",
  "holding": "<The court's actual decision — who won and on what ground. Only state what is in the text.>",
  "reasoning": "<The legal principles, statutes, and precedents the court applied to reach its decision. Only reference materials explicitly mentioned in the text.>",
  "significance": "<Why this case matters as precedent — what rule of law it established or confirmed.>",
  "relatedCases": ["<Only include cases explicitly cited within the provided text. If none are cited, return an empty array.>"],
  "practiceQuestions": ["<3 original exam-style questions a law student could answer using ONLY the analysis above>"]
}

IMPORTANT RULES:
- NEVER fabricate case names, citation numbers, judge names, or statutes not found in the text.
- If a field cannot be determined from the text, write "Not determinable from provided text."
- relatedCases must only list cases that appear by name in the case text.
- Return ONLY valid JSON. No markdown. No commentary outside the JSON.

CASE TEXT:
${caseText}`;
}

// ─── Standard Chat ─────────────────────────────────────────────────────────────

export const chat = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { message, sessionId, documentContext } = req.body;
    if (!message) {
      sendBadRequest(res, "Message is required");
      return;
    }

    const isNew = !sessionId;
    const sid = sessionId ?? uuidv4();
    const history = ((await redisService.getConversation(sid)) as ConversationMessage[]) ?? [];

    const systemContext = [
      documentContext
        ? `The student is currently reading: ${documentContext}. Answer questions in context of this document.`
        : null,
      "Keep responses concise and conversational — 2 to 5 short paragraphs. Write in plain prose without markdown tables, headers, or bullet lists.",
    ]
      .filter(Boolean)
      .join(" ");

    const reply = await deepseekService.chatWithHistory(
      [...history, { role: "user", content: message, timestamp: new Date() }],
      systemContext
    );

    const updatedHistory: ConversationMessage[] = [
      ...history,
      { role: "user", content: message, timestamp: new Date() },
      { role: "assistant", content: reply, timestamp: new Date() },
    ];

    await redisService.setConversation(sid, updatedHistory);

    // Persist conversation metadata + full transcript for sidebar history
    if (isNew) {
      await Conversation.create({
        userId: req.user!.userId,
        sessionId: sid,
        title: message.slice(0, 80),
        messageCount: 1,
        lastMessage: reply.slice(0, 120),
        mode: "standard",
        messages: toStoredMessages(updatedHistory),
      });
    } else {
      await Conversation.findOneAndUpdate(
        { sessionId: sid, userId: req.user!.userId },
        {
          $inc: { messageCount: 1 },
          lastMessage: reply.slice(0, 120),
          messages: toStoredMessages(updatedHistory),
        }
      );
    }

    await Progress.findOneAndUpdate(
      { userId: req.user!.userId, date: today() },
      { $inc: { aiQueriesCount: 1 } },
      { upsert: true, new: true }
    );

    sendSuccess(res, { reply, sessionId: sid }, "AI response");
  } catch (err) {
    sendError(res, "AI chat failed", 500, (err as Error).message);
  }
};

// ─── Streaming Chat ────────────────────────────────────────────────────────────

export const streamChat = async (req: AuthRequest, res: Response): Promise<void> => {
  const { message, sessionId, documentContext } = req.body;
  if (!message) {
    res.status(400).json({ success: false, message: "Message is required" });
    return;
  }

  const isNew = !sessionId;
  const sid = sessionId ?? uuidv4();
  const history = ((await redisService.getConversation(sid)) as ConversationMessage[]) ?? [];

  const systemContext = [
    documentContext
      ? `The student is currently reading: ${documentContext}. Answer questions in context of this document.`
      : null,
    "Keep responses concise and conversational — 2 to 5 short paragraphs. Write in plain prose without markdown tables, headers, or bullet lists.",
  ]
    .filter(Boolean)
    .join(" ");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  let fullReply = "";

  try {
    for await (const chunk of deepseekService.streamChat(message, history, systemContext)) {
      fullReply += chunk;
      res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
    }

    if (!fullReply.trim()) {
      res.write(
        `data: ${JSON.stringify({ error: "The AI returned an empty reply. Please try again." })}\n\n`
      );
      res.end();
      return;
    }

    // Do not persist truncated table/markdown stubs so non-stream fallback can retry cleanly.
    const trimmed = fullReply.trim();
    const looksTruncated =
      trimmed.length < 40 ||
      /\|$/.test(trimmed) ||
      /Section\s*\|$/i.test(trimmed) ||
      /^[A-Z]$/.test(trimmed);
    if (looksTruncated) {
      res.write(
        `data: ${JSON.stringify({ error: "The AI returned an incomplete reply. Please try again." })}\n\n`
      );
      res.end();
      return;
    }

    const updatedHistory: ConversationMessage[] = [
      ...history,
      { role: "user", content: message, timestamp: new Date() },
      { role: "assistant", content: fullReply, timestamp: new Date() },
    ];

    await redisService.setConversation(sid, updatedHistory);

    if (isNew) {
      await Conversation.create({
        userId: req.user!.userId,
        sessionId: sid,
        title: message.slice(0, 80),
        messageCount: 1,
        lastMessage: fullReply.slice(0, 120),
        mode: "standard",
        messages: toStoredMessages(updatedHistory),
      });
    } else {
      await Conversation.findOneAndUpdate(
        { sessionId: sid, userId: req.user!.userId },
        {
          $inc: { messageCount: 1 },
          lastMessage: fullReply.slice(0, 120),
          messages: toStoredMessages(updatedHistory),
        }
      );
    }

    await Progress.findOneAndUpdate(
      { userId: req.user!.userId, date: today() },
      { $inc: { aiQueriesCount: 1 } },
      { upsert: true, new: true }
    );

    res.write(`data: ${JSON.stringify({ done: true, sessionId: sid })}\n\n`);
    res.end();
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Stream failed";
    res.write(`data: ${JSON.stringify({ error: detail })}\n\n`);
    res.end();
  }
};

// ─── Conversation History ──────────────────────────────────────────────────────

export const getConversations = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = "1", limit = "20" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const [conversations, total] = await Promise.all([
      Conversation.find({ userId: req.user!.userId, mode: "standard" })
        .select("-messages")
        .skip(skip)
        .limit(parseInt(limit as string))
        .sort({ updatedAt: -1 }),
      Conversation.countDocuments({ userId: req.user!.userId, mode: "standard" }),
    ]);

    sendSuccess(res, conversations, "Conversations retrieved", 200, { total });
  } catch (err) {
    sendError(res, "Failed to retrieve conversations", 500, (err as Error).message);
  }
};

export const getConversation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = String(req.params.sessionId ?? "");
    const convo = await Conversation.findOne({
      sessionId,
      userId: req.user!.userId,
    });
    if (!convo) {
      sendNotFound(res, "Conversation not found");
      return;
    }

    let messages: IConversationMessage[] = convo.messages ?? [];
    if (!messages.length) {
      const cached = (await redisService.getConversation(sessionId)) as
        | ConversationMessage[]
        | null;
      if (cached?.length) messages = toStoredMessages(cached);
    }

    sendSuccess(
      res,
      {
        sessionId: convo.sessionId,
        title: convo.title,
        messageCount: convo.messageCount,
        lastMessage: convo.lastMessage,
        createdAt: (convo as unknown as { createdAt: Date }).createdAt,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        })),
      },
      "Conversation retrieved"
    );
  } catch (err) {
    sendError(res, "Failed to retrieve conversation", 500, (err as Error).message);
  }
};

export const deleteConversation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;

    const convo = await Conversation.findOne({ sessionId, userId: req.user!.userId });
    if (!convo) {
      sendNotFound(res, "Conversation not found");
      return;
    }

    await Promise.all([convo.deleteOne(), redisService.del(`conv:${sessionId}`)]);

    sendSuccess(res, null, "Conversation deleted");
  } catch (err) {
    sendError(res, "Failed to delete conversation", 500, (err as Error).message);
  }
};

// ─── Case Explainer ────────────────────────────────────────────────────────────

export const explainCase = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { caseText, text, citation, documentId } = req.body as {
      caseText?: string;
      text?: string;
      citation?: string;
      documentId?: string;
    };

    let resolvedText = (caseText ?? text ?? "").trim();
    let resolvedDocumentId = documentId?.trim() || undefined;
    const citationInput = (citation ?? "").trim();
    const lookupQuery = citationInput || (looksLikeCitationQuery(resolvedText) ? resolvedText : "");

    if (!resolvedText && resolvedDocumentId) {
      const doc = await LibraryDocument.findById(resolvedDocumentId).lean();
      if (!doc) {
        sendBadRequest(res, "Document not found");
        return;
      }
      const extracted = await fetchDocumentText(doc.s3Key);
      if (extracted) {
        resolvedText = extracted;
      } else {
        // PDF / binary uploads: fall back to title/citation for a knowledge brief.
        resolvedText = (doc.metadata?.citation || doc.title || lookupQuery || "").trim();
      }
    }

    // Citation / case-name input: prefer a Library judgment when available.
    if (lookupQuery && (!resolvedText || looksLikeCitationQuery(resolvedText))) {
      const matched = await findLibraryCaseByQuery(lookupQuery);
      if (matched) {
        resolvedDocumentId = String(matched._id);
        const extracted = matched.s3Key ? await fetchDocumentText(matched.s3Key) : "";
        if (extracted) {
          resolvedText = extracted;
        } else {
          resolvedText =
            resolvedText || (matched.metadata?.citation || matched.title || lookupQuery).trim();
        }
      } else if (!resolvedText) {
        resolvedText = lookupQuery;
      }
    }

    if (!resolvedText) {
      sendBadRequest(
        res,
        "Provide a case name/citation, paste the judgment text, or select a Library document"
      );
      return;
    }

    const mode: "full_text" | "citation" =
      looksLikeCitationQuery(resolvedText) && resolvedText.length <= 400 ? "citation" : "full_text";

    const cacheKey = `case_explain:${mode}:${Buffer.from(resolvedText.slice(0, 120)).toString("base64")}`;
    const cached = await redisService.get(cacheKey);

    const persistAndRespond = async (explanation: CaseBrief, message: string) => {
      const saved = await CaseExplanation.create({
        userId: req.user!.userId,
        documentId: resolvedDocumentId ?? undefined,
        inputText: resolvedText.slice(0, 500),
        ...explanation,
      });

      await Progress.findOneAndUpdate(
        { userId: req.user!.userId, date: today() },
        { $inc: { casesExplained: 1 } },
        { upsert: true, new: true }
      );

      const id = saved._id.toString();
      sendSuccess(res, { ...explanation, id, _id: id }, message);
    };

    if (cached) {
      const cachedBrief = normalizeCaseBrief(cached);
      if (isCaseBriefComplete(cachedBrief)) {
        await persistAndRespond(cachedBrief, "Case explanation (cached)");
        return;
      }
      // Drop incomplete cache entries from earlier bad model replies.
      await redisService.del(cacheKey);
    }

    let explanation = normalizeCaseBrief(
      await deepseekService.structuredCompletion<Record<string, unknown>>(
        buildCaseExplainerPrompt(resolvedText, mode),
        undefined,
        AI_LIMITS.MAX_TOKENS.CASE_EXPLAINER
      )
    );

    // One repair pass if the model returned valid JSON but left core fields empty.
    if (!isCaseBriefComplete(explanation)) {
      explanation = normalizeCaseBrief(
        await deepseekService.structuredCompletion<Record<string, unknown>>(
          `Fill EVERY field in this case-brief JSON. Do not leave facts, issue, or holding empty.

CASE NAME / TEXT:
${resolvedText.slice(0, 4000)}

CURRENT (incomplete) JSON:
${JSON.stringify(explanation)}

Return the complete JSON object with keys: citation, facts, issue, holding, reasoning, significance, relatedCases, practiceQuestions.`,
          undefined,
          AI_LIMITS.MAX_TOKENS.CASE_EXPLAINER
        )
      );
    }

    if (!explanation.citation) {
      explanation.citation = resolvedText.slice(0, 160);
    }

    if (isCaseBriefComplete(explanation)) {
      await redisService.set(cacheKey, explanation, 86400);
    }
    await persistAndRespond(explanation, "Case explained");
  } catch (err) {
    sendError(res, "Case explanation failed", 500, (err as Error).message);
  }
};

export const getCaseExplainerHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = "1", limit = "20" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const [explanations, total] = await Promise.all([
      CaseExplanation.find({ userId: req.user!.userId })
        .select("citation facts issue holding significance createdAt savedToNoteId")
        .skip(skip)
        .limit(parseInt(limit as string))
        .sort({ createdAt: -1 })
        .lean(),
      CaseExplanation.countDocuments({ userId: req.user!.userId }),
    ]);

    sendSuccess(
      res,
      explanations.map((item) => ({
        ...item,
        id: String(item._id),
      })),
      "Case explainer history retrieved",
      200,
      { total }
    );
  } catch (err) {
    sendError(res, "Failed to retrieve case history", 500, (err as Error).message);
  }
};

export const getCaseExplanation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const explanation = await CaseExplanation.findOne({
      _id: req.params.id,
      userId: req.user!.userId,
    });
    if (!explanation) {
      sendNotFound(res, "Case explanation not found");
      return;
    }
    sendSuccess(res, explanation, "Case explanation retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve case explanation", 500, (err as Error).message);
  }
};

export const saveCaseToNotes = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const explanation = await CaseExplanation.findOne({
      _id: req.params.id,
      userId: req.user!.userId,
    });
    if (!explanation) {
      sendNotFound(res, "Case explanation not found");
      return;
    }

    const noteContent = `
<h2>${explanation.citation || "Case Explanation"}</h2>
<h3>Facts</h3><p>${explanation.facts}</p>
<h3>Issue</h3><p>${explanation.issue}</p>
<h3>Holding</h3><p>${explanation.holding}</p>
<h3>Reasoning</h3><p>${explanation.reasoning}</p>
<h3>Significance</h3><p>${explanation.significance}</p>
<h3>Related Cases</h3><ul>${explanation.relatedCases.map((c) => `<li>${c}</li>`).join("")}</ul>
<h3>Practice Questions</h3><ul>${explanation.practiceQuestions.map((q) => `<li>${q}</li>`).join("")}</ul>
`.trim();

    const note = await Note.create({
      userId: req.user!.userId,
      title: explanation.citation || "Case Explanation",
      content: noteContent,
      source: "case_explainer",
      sourceRef: explanation._id.toString(),
      tags: ["case", "explainer"],
    });

    explanation.savedToNoteId = note._id as typeof explanation.savedToNoteId;
    await explanation.save();

    await Progress.findOneAndUpdate(
      { userId: req.user!.userId, date: today() },
      { $inc: { notesCreated: 1 } },
      { upsert: true, new: true }
    );

    sendCreated(res, { note }, "Case saved to notes");
  } catch (err) {
    sendError(res, "Failed to save case to notes", 500, (err as Error).message);
  }
};

// ─── Socratic Tutor ─────────────────────────────────────────────────────────────

export const startSocraticSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { topic } = req.body;
    if (!topic) {
      sendBadRequest(res, "Topic is required");
      return;
    }

    const sessionId = uuidv4();
    const openingQuestion = await socraticService.openingQuestion(topic);

    const session = {
      sessionId,
      userId: req.user!.userId,
      topic,
      messages: [{ role: "assistant", content: openingQuestion, timestamp: new Date() }],
      hintsUsed: 0,
      mode: "socratic",
    };

    await redisService.set(`socratic:${sessionId}`, session, 3600);

    await Conversation.create({
      userId: req.user!.userId,
      sessionId,
      title: `Socratic: ${topic.slice(0, 60)}`,
      messageCount: 1,
      lastMessage: openingQuestion.slice(0, 120),
      mode: "socratic",
    });

    sendSuccess(res, { sessionId, question: openingQuestion }, "Socratic session started");
  } catch (err) {
    sendError(res, "Failed to start Socratic session", 500, (err as Error).message);
  }
};

export const respondSocratic = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sessionId, response, message, requestHint } = req.body as {
      sessionId?: string;
      response?: string;
      message?: string;
      requestHint?: boolean;
    };
    const studentResponse = (response ?? message ?? "").trim();
    if (!sessionId) {
      sendBadRequest(res, "sessionId is required");
      return;
    }

    const session = await redisService.get<{
      messages: ConversationMessage[];
      hintsUsed: number;
      topic: string;
    }>(`socratic:${sessionId}`);

    if (!session) {
      sendBadRequest(res, "Session not found or expired");
      return;
    }

    let aiResponse: string;

    if (requestHint) {
      const hintsRemaining = Math.max(0, 3 - session.hintsUsed - 1);
      aiResponse = await socraticService.provideHint(session.messages, hintsRemaining);
      session.hintsUsed += 1;
    } else {
      if (!studentResponse) {
        sendBadRequest(res, "Response is required");
        return;
      }
      aiResponse = await socraticService.continueSession(session.messages, studentResponse);
      session.messages.push({ role: "user", content: studentResponse, timestamp: new Date() });
    }

    session.messages.push({ role: "assistant", content: aiResponse, timestamp: new Date() });
    await redisService.set(`socratic:${sessionId}`, session, 3600);

    await Conversation.findOneAndUpdate(
      { sessionId },
      { $inc: { messageCount: 1 }, lastMessage: aiResponse.slice(0, 120) }
    );

    sendSuccess(res, { aiResponse, hintsUsed: session.hintsUsed }, "Socratic response");
  } catch (err) {
    sendError(res, "Socratic session error", 500, (err as Error).message);
  }
};

export const endSocraticSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.body;
    const session = await redisService.get<{ messages: ConversationMessage[]; topic: string }>(
      `socratic:${sessionId}`
    );
    if (!session) {
      sendBadRequest(res, "Session not found");
      return;
    }

    const summary = await socraticService.generateSessionSummary(session.messages, session.topic);
    await redisService.del(`socratic:${sessionId}`);
    sendSuccess(
      res,
      {
        ...summary,
        score: summary.understanding,
      },
      "Session ended"
    );
  } catch (err) {
    sendError(res, "Failed to end session", 500, (err as Error).message);
  }
};
