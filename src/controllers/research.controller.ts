import { Response } from "express";
import { AuthRequest } from "../types";
import { ResearchSession } from "../models/ResearchSession";
import { LibraryDocument } from "../models/Document";
import { Note } from "../models/Note";
import { deepseekService } from "../services/ai/deepseek.service";
import { Progress } from "../models/Progress";
import {
  sendSuccess,
  sendCreated,
  sendNotFound,
  sendBadRequest,
  sendError,
} from "../utils/response";

const today = () => new Date().toISOString().split("T")[0];

/** Score a document against query terms without any external call. */
function scoreDocument(
  doc: { title: string; subject?: string; metadata?: { description?: string; jurisdiction?: string } },
  terms: string[]
): number {
  const haystack = [
    doc.title,
    doc.subject ?? "",
    doc.metadata?.description ?? "",
    doc.metadata?.jurisdiction ?? "",
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += 1;
    // Bonus if term appears in title
    if (doc.title.toLowerCase().includes(term)) score += 0.5;
  }
  return terms.length > 0 ? score / (terms.length * 1.5) : 0;
}

export const search = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { query, subject, type, jurisdiction, courtLevel } = req.body;
    if (!query) {
      sendBadRequest(res, "Search query is required");
      return;
    }

    const terms = (query as string)
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((t: string) => t.length > 2);

    const docFilter: Record<string, unknown> = { isLibraryContent: true };
    if (subject) docFilter.subject = subject;
    if (type) docFilter.type = type;
    if (jurisdiction) docFilter["metadata.jurisdiction"] = jurisdiction;
    if (courtLevel) docFilter["metadata.courtLevel"] = courtLevel;

    // Primary: full-text search (MongoDB index); fallback to regex scan if no hits
    let results = await LibraryDocument.find({
      ...docFilter,
      $text: { $search: query },
    })
      .select("title type subject metadata s3Url")
      .limit(20)
      .lean();

    if (results.length === 0) {
      // Fallback: regex match on title / description when text index has no hits
      const regexTerms = terms.map((t: string) => new RegExp(t, "i"));
      results = await LibraryDocument.find({
        ...docFilter,
        $or: [
          { title: { $in: regexTerms } },
          { "metadata.description": { $in: regexTerms } },
        ],
      })
        .select("title type subject metadata s3Url")
        .limit(20)
        .lean();
    }

    // Algorithm: score and sort results locally
    const scored = results
      .map((doc) => ({ doc, score: scoreDocument(doc, terms) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    interface AlgoResult {
      title: string;
      relevanceScore: number;
      snippet: string;
      type: string;
    }

    const algoResults: AlgoResult[] = scored.map(({ doc, score }) => ({
      title: doc.title,
      relevanceScore: parseFloat(Math.min(score, 1).toFixed(2)),
      snippet: doc.metadata?.description ?? `${doc.type} — ${doc.subject ?? "Legal document"}`,
      type: doc.type,
    }));

    // Save session with algorithm results immediately
    const session = await ResearchSession.create({
      userId: req.user!.userId,
      query,
      refinedQuery: query,
      results: scored.map(({ doc, score }, i) => ({
        documentId: doc._id,
        title: algoResults[i].title,
        snippet: algoResults[i].snippet,
        relevanceScore: algoResults[i].relevanceScore,
        type: doc.type ?? "case_law",
      })),
    });

    await Progress.findOneAndUpdate(
      { userId: req.user!.userId, date: today() },
      { $inc: { researchSessions: 1 } },
      { upsert: true, new: true }
    );

    // Respond immediately — don't block on DeepSeek
    sendCreated(
      res,
      {
        sessionId: session._id,
        refinedQuery: query,
        results: algoResults,
        rawCount: results.length,
      },
      "Research results"
    );

    // Fire-and-forget: let DeepSeek optionally improve the session (non-blocking)
    if (results.length > 0) {
      deepseekService
        .chat(
          `Rewrite this research query as a precise Nigerian legal research question: "${query}". Return only the refined question, nothing else.`
        )
        .then((refinedQuery) => {
          ResearchSession.findByIdAndUpdate(session._id, { refinedQuery }).catch(() => {});
        })
        .catch(() => {
          // DeepSeek failure is silently ignored
        });
    }
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
    if (!session) {
      sendNotFound(res, "Research session not found");
      return;
    }

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
    if (!session) {
      sendNotFound(res, "Session not found");
      return;
    }
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
    if (!session) {
      sendNotFound(res, "Research session not found");
      return;
    }

    const { resultIndex } = req.body;
    const idx = parseInt(resultIndex ?? "0");
    const result = session.results[idx];

    if (!result) {
      sendBadRequest(res, "Result not found at given index");
      return;
    }

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
    if (!session) {
      sendNotFound(res, "Session not found");
      return;
    }
    sendSuccess(res, null, "Research session deleted");
  } catch (err) {
    sendError(res, "Failed to delete session", 500, (err as Error).message);
  }
};
