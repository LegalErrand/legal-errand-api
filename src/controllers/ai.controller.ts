import { Response } from "express";
import { AuthRequest, ConversationMessage } from "../types";
import { deepseekService } from "../services/ai/deepseek.service";
import { socraticService } from "../services/ai/socratic.service";
import { redisService } from "../services/cache/redis.service";
import { Progress } from "../models/Progress";
import { sendSuccess, sendBadRequest, sendError } from "../utils/response";
import { v4 as uuidv4 } from "uuid";

const today = () => new Date().toISOString().split("T")[0];

// ─── Standard Chat ─────────────────────────────────────────────────────────────

export const chat = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { message, sessionId, documentContext } = req.body;
    if (!message) { sendBadRequest(res, "Message is required"); return; }

    const sid = sessionId ?? uuidv4();
    const history = (await redisService.getConversation(sid) as ConversationMessage[]) ?? [];

    const systemContext = documentContext
      ? `The student is currently reading: ${documentContext}. Answer questions in context of this document.`
      : undefined;

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

    // Track activity
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
  if (!message) { res.status(400).json({ success: false, message: "Message is required" }); return; }

  const sid = sessionId ?? uuidv4();
  const history = (await redisService.getConversation(sid) as ConversationMessage[]) ?? [];

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
    res.write(`data: ${JSON.stringify({ done: true, sessionId: sid })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: "Stream failed" })}\n\n`);
    res.end();
  }
};

// ─── Case Explainer ────────────────────────────────────────────────────────────

export const explainCase = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { caseText, documentId } = req.body;
    if (!caseText) { sendBadRequest(res, "Case text is required"); return; }

    const cacheKey = `case_explain:${Buffer.from(caseText.slice(0, 100)).toString("base64")}`;
    const cached = await redisService.get(cacheKey);
    if (cached) { sendSuccess(res, cached, "Case explanation (cached)"); return; }

    const prompt = `Analyze and explain this case using the following structured format. Return a JSON object:
{
  "citation": "<proper legal citation>",
  "facts": "<simplified narrative of what happened>",
  "issue": "<the legal question the court addressed>",
  "holding": "<the court's decision>",
  "reasoning": "<why the court decided this way — legal principles applied>",
  "significance": "<why this case matters — precedent value>",
  "relatedCases": ["<case 1>", "<case 2>"],
  "practiceQuestions": ["<question 1>", "<question 2>", "<question 3>"]
}

CASE TEXT:
${caseText}`;

    const explanation = await deepseekService.structuredCompletion(prompt);

    await redisService.set(cacheKey, explanation, 86400); // cache for 24h

    // Track activity
    await Progress.findOneAndUpdate(
      { userId: req.user!.userId, date: today() },
      { $inc: { casesExplained: 1 } },
      { upsert: true, new: true }
    );

    sendSuccess(res, explanation, "Case explained");
  } catch (err) {
    sendError(res, "Case explanation failed", 500, (err as Error).message);
  }
};

// ─── Socratic Tutor ─────────────────────────────────────────────────────────────

export const startSocraticSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { topic } = req.body;
    if (!topic) { sendBadRequest(res, "Topic is required"); return; }

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
    sendSuccess(res, { sessionId, openingQuestion }, "Socratic session started");
  } catch (err) {
    sendError(res, "Failed to start Socratic session", 500, (err as Error).message);
  }
};

export const respondSocratic = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sessionId, response: studentResponse, requestHint } = req.body;
    if (!sessionId) { sendBadRequest(res, "sessionId is required"); return; }

    const session = await redisService.get<{
      messages: ConversationMessage[];
      hintsUsed: number;
      topic: string;
    }>(`socratic:${sessionId}`);

    if (!session) { sendBadRequest(res, "Session not found or expired"); return; }

    let aiResponse: string;

    if (requestHint) {
      const hintsRemaining = Math.max(0, 3 - session.hintsUsed - 1);
      aiResponse = await socraticService.provideHint(session.messages, hintsRemaining);
      session.hintsUsed += 1;
    } else {
      if (!studentResponse) { sendBadRequest(res, "Response is required"); return; }
      aiResponse = await socraticService.continueSession(session.messages, studentResponse);
      session.messages.push({ role: "user", content: studentResponse, timestamp: new Date() });
    }

    session.messages.push({ role: "assistant", content: aiResponse, timestamp: new Date() });
    await redisService.set(`socratic:${sessionId}`, session, 3600);

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
    if (!session) { sendBadRequest(res, "Session not found"); return; }

    const summary = await socraticService.generateSessionSummary(session.messages, session.topic);
    await redisService.del(`socratic:${sessionId}`);
    sendSuccess(res, summary, "Session ended");
  } catch (err) {
    sendError(res, "Failed to end session", 500, (err as Error).message);
  }
};
