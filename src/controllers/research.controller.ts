import { Response } from "express";
import { AuthRequest } from "../types";
import { ResearchSession } from "../models/ResearchSession";
import { LibraryDocument } from "../models/Document";
import { Note } from "../models/Note";
import { deepseekService } from "../services/ai/deepseek.service";
import { Progress } from "../models/Progress";
import { sendSuccess, sendCreated, sendNotFound, sendBadRequest, sendError } from "../utils/response";

const today = () => new Date().toISOString().split("T")[0];

export const search = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { query, subject, type, jurisdiction, courtLevel } = req.body;
    if (!query) { sendBadRequest(res, "Search query is required"); return; }

    const refinedQuery = await deepseekService.chat(
      `Rewrite this research query as a precise Nigerian legal research question: "${query}". Return only the refined question, nothing else.`
    );

    const docFilter: Record<string, unknown> = { isLibraryContent: true };
    if (subject) docFilter.subject = subject;
    if (type) docFilter.type = type;

    // jurisdiction and courtLevel are stored in document metadata
    if (jurisdiction) docFilter["metadata.jurisdiction"] = jurisdiction;
    if (courtLevel) docFilter["metadata.courtLevel"] = courtLevel;

    const results = await LibraryDocument.find({
      ...docFilter,
      $text: { $search: query },
    })
      .select("title type subject metadata s3Url")
      .limit(10)
      .lean();

    interface RankedResult {
      title: string;
      relevanceScore: number;
      snippet: string;
      whyRelevant: string;
    }

    const rankedResults = results.length > 0
      ? await deepseekService.structuredCompletion<{ results: RankedResult[] }>(
          `For the research query: "${refinedQuery}", rank and annotate these Nigerian legal sources by relevance.
Sources: ${JSON.stringify(results.map((r) => ({ title: r.title, type: r.type, subject: r.subject })))}

Return JSON:
{
  "results": [{ "title": "<title>", "relevanceScore": <0-1>, "snippet": "<why this is relevant>", "whyRelevant": "<brief explanation>" }]
}`
        )
      : { results: [] };

    const session = await ResearchSession.create({
      userId: req.user!.userId,
      query,
      refinedQuery,
      results: rankedResults.results.map((r: RankedResult, i: number) => ({
        documentId: results[i]?._id,
        title: r.title,
        snippet: r.snippet,
        relevanceScore: r.relevanceScore,
        type: results[i]?.type ?? "case_law",
      })),
    });

    await Progress.findOneAndUpdate(
      { userId: req.user!.userId, date: today() },
      { $inc: { researchSessions: 1 } },
      { upsert: true, new: true }
    );

    sendCreated(res, {
      sessionId: session._id,
      refinedQuery,
      results: rankedResults.results,
      rawCount: results.length,
    }, "Research results");
  } catch (err) {
    sendError(res, "Research search failed", 500, (err as Error).message);
  }
};

export const generateMemo = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const session = await ResearchSession.findOne({
      _id: req.params.sessionId,
      userId: req.user!.userId,
    });
    if (!session) { sendNotFound(res, "Research session not found"); return; }

    const memo = await deepseekService.chat(
      `Generate a structured Nigerian legal research memo based on these findings:
Query: ${session.refinedQuery ?? session.query}
Sources found: ${session.results.map((r) => r.title).join(", ")}

Format as: 1) Research Question 2) Summary of Law 3) Key Cases 4) Key Statutes 5) Analysis 6) Conclusion`,
      undefined,
      4000
    );

    session.memo = memo;
    await session.save();

    sendSuccess(res, { memo }, "Research memo generated");
  } catch (err) {
    sendError(res, "Memo generation failed", 500, (err as Error).message);
  }
};

export const getSessions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = "1", limit = "10" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const [sessions, total] = await Promise.all([
      ResearchSession.find({ userId: req.user!.userId })
        .select("query refinedQuery qualityScore createdAt")
        .skip(skip)
        .limit(parseInt(limit as string))
        .sort({ createdAt: -1 }),
      ResearchSession.countDocuments({ userId: req.user!.userId }),
    ]);

    sendSuccess(res, sessions, "Research sessions retrieved", 200, { total });
  } catch (err) {
    sendError(res, "Failed to retrieve sessions", 500, (err as Error).message);
  }
};

export const getSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const session = await ResearchSession.findOne({
      _id: req.params.id,
      userId: req.user!.userId,
    });
    if (!session) { sendNotFound(res, "Session not found"); return; }
    sendSuccess(res, session, "Session retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve session", 500, (err as Error).message);
  }
};

export const saveResultToNotes = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const session = await ResearchSession.findOne({
      _id: req.params.id,
      userId: req.user!.userId,
    });
    if (!session) { sendNotFound(res, "Research session not found"); return; }

    const { resultIndex } = req.body;
    const idx = parseInt(resultIndex ?? "0");
    const result = session.results[idx];

    if (!result) { sendBadRequest(res, "Result not found at given index"); return; }

    const noteContent = `
<h2>${result.title}</h2>
<p><strong>Relevance:</strong> ${Math.round((result.relevanceScore ?? 0) * 100)}%</p>
<h3>Summary</h3><p>${result.snippet}</p>
<p><em>Source: Legal Research — "${session.query}"</em></p>
`.trim();

    const note = await Note.create({
      userId: req.user!.userId,
      title: result.title,
      content: noteContent,
      source: "research",
      sourceRef: session._id.toString(),
      tags: ["research", "legal"],
    });

    await Progress.findOneAndUpdate(
      { userId: req.user!.userId, date: today() },
      { $inc: { notesCreated: 1 } },
      { upsert: true, new: true }
    );

    sendCreated(res, { note }, "Research result saved to notes");
  } catch (err) {
    sendError(res, "Failed to save result to notes", 500, (err as Error).message);
  }
};

export const deleteSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const session = await ResearchSession.findOneAndDelete({
      _id: req.params.id,
      userId: req.user!.userId,
    });
    if (!session) { sendNotFound(res, "Session not found"); return; }
    sendSuccess(res, null, "Research session deleted");
  } catch (err) {
    sendError(res, "Failed to delete session", 500, (err as Error).message);
  }
};
