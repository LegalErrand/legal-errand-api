import { Response } from "express";
import { AuthRequest, ConversationMessage } from "../types";
import { deepseekService } from "../services/ai/deepseek.service";
import { socraticService } from "../services/ai/socratic.service";
import { redisService } from "../services/cache/redis.service";
import { Progress } from "../models/Progress";
import { Note } from "../models/Note";
import { CaseExplanation } from "../models/CaseExplanation";
import { Conversation } from "../models/Conversation";
import { LibraryDocument } from "../models/Document";
import { s3Client, S3_BUCKET } from "../config/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendError,
} from "../utils/response";
import { v4 as uuidv4 } from "uuid";

async function fetchDocumentText(s3Key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key });
  const response = await s3Client.send(command);
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8").slice(0, 15000);
}

const today = () => new Date().toISOString().split("T")[0];

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

    // Persist conversation metadata to MongoDB for history listing
    if (isNew) {
      await Conversation.create({
        userId: req.user!.userId,
        sessionId: sid,
        title: message.slice(0, 80),
        messageCount: 1,
        lastMessage: reply.slice(0, 120),
        mode: "standard",
      });
    } else {
      await Conversation.findOneAndUpdate(
        { sessionId: sid },
        { $inc: { messageCount: 1 }, lastMessage: reply.slice(0, 120) }
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

  const systemContext = documentContext
    ? `The student is currently reading: ${documentContext}. Answer questions in context of this document.`
    : undefined;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullReply = "";

  try {
    for await (const chunk of deepseekService.streamChat(message, history, systemContext)) {
      fullReply += chunk;
      res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
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
      });
    } else {
      await Conversation.findOneAndUpdate(
        { sessionId: sid },
        { $inc: { messageCount: 1 }, lastMessage: fullReply.slice(0, 120) }
      );
    }

    res.write(`data: ${JSON.stringify({ done: true, sessionId: sid })}\n\n`);
    res.end();
  } catch {
    res.write(`data: ${JSON.stringify({ error: "Stream failed" })}\n\n`);
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
    let { caseText, documentId } = req.body;

    if (!caseText && documentId) {
      const doc = await LibraryDocument.findById(documentId).lean();
      if (!doc) {
        sendBadRequest(res, "Document not found");
        return;
      }
      caseText = await fetchDocumentText(doc.s3Key);
    }

    if (!caseText) {
      sendBadRequest(res, "Either caseText or documentId is required");
      return;
    }

    const cacheKey = `case_explain:${Buffer.from(caseText.slice(0, 100)).toString("base64")}`;
    const cached = await redisService.get(cacheKey);

    if (cached) {
      sendSuccess(res, cached, "Case explanation (cached)");
      return;
    }

    const prompt = `You are a senior Nigerian law lecturer. Analyze ONLY the case text provided below — do not invent or assume any facts not found in the text. Return a JSON object in exactly this structure:

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

    const explanation = await deepseekService.structuredCompletion<{
      citation: string;
      facts: string;
      issue: string;
      holding: string;
      reasoning: string;
      significance: string;
      relatedCases: string[];
      practiceQuestions: string[];
    }>(prompt);

    await redisService.set(cacheKey, explanation, 86400);

    // Persist to MongoDB so user has an archive
    const saved = await CaseExplanation.create({
      userId: req.user!.userId,
      documentId: documentId ?? undefined,
      inputText: caseText.slice(0, 500),
      ...explanation,
    });

    await Progress.findOneAndUpdate(
      { userId: req.user!.userId, date: today() },
      { $inc: { casesExplained: 1 } },
      { upsert: true, new: true }
    );

    sendSuccess(res, { ...explanation, _id: saved._id }, "Case explained");
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
        .sort({ createdAt: -1 }),
      CaseExplanation.countDocuments({ userId: req.user!.userId }),
    ]);

    sendSuccess(res, explanations, "Case explainer history retrieved", 200, { total });
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
    const { sessionId, response: studentResponse, requestHint } = req.body;
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
    sendSuccess(res, summary, "Session ended");
  } catch (err) {
    sendError(res, "Failed to end session", 500, (err as Error).message);
  }
};
