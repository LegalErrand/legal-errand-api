import { Response } from "express";
import { AuthRequest } from "../types";
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

// ─── Note templates (static) ───────────────────────────────────────────────────

const NOTE_TEMPLATES = [
  {
    id: "blank",
    name: "Blank Note",
    description: "Start from a blank slate for custom research or unique drafting requirements.",
    category: "GENERAL",
    content: "",
    tags: [],
  },
  {
    id: "irac",
    name: "IRAC Framework",
    description:
      "Master the standard method for legal analysis: Issue, Rule, Application, and Conclusion.",
    category: "ACADEMIC",
    content:
      "<h2>Issue</h2><p>State the legal question...</p><h2>Rule</h2><p>State the applicable law...</p><h2>Application</h2><p>Apply the law to the facts...</p><h2>Conclusion</h2><p>State your conclusion...</p>",
    tags: ["irac", "analysis"],
  },
  {
    id: "case_brief",
    name: "Case Brief",
    description: "Summarize judicial opinions, procedural history, and core legal holdings.",
    category: "RESEARCH",
    content:
      "<h2>Citation</h2><p></p><h2>Facts</h2><p></p><h2>Issue</h2><p></p><h2>Holding</h2><p></p><h2>Reasoning</h2><p></p><h2>Significance</h2><p></p>",
    tags: ["case", "brief"],
  },
  {
    id: "statute_summary",
    name: "Statute Summary",
    description: "Concise breakdown of legislative Acts, provisions and effective dates.",
    category: "COMPLIANCE",
    content:
      "<h2>Act / Statute</h2><p></p><h2>Key Provisions</h2><ul><li></li></ul><h2>Effective Date</h2><p></p><h2>Relevance</h2><p></p>",
    tags: ["statute", "legislation"],
  },
  {
    id: "research_memo",
    name: "Research Memo",
    description:
      "Draft internal office memo with proper citation, legal questions, and actionable insights.",
    category: "INTERNAL",
    content:
      "<h2>Research Question</h2><p></p><h2>Summary of Law</h2><p></p><h2>Key Cases</h2><ul><li></li></ul><h2>Key Statutes</h2><ul><li></li></ul><h2>Analysis</h2><p></p><h2>Conclusion</h2><p></p>",
    tags: ["memo", "research"],
  },
  {
    id: "lecture_note",
    name: "Lecture Note",
    description: "Streamlined layout for law school lectures or legal seminar tracking.",
    category: "EDUCATION",
    content:
      "<h2>Topic</h2><p></p><h2>Key Concepts</h2><ul><li></li></ul><h2>Cases Mentioned</h2><ul><li></li></ul><h2>Questions to Follow Up</h2><ul><li></li></ul>",
    tags: ["lecture", "study"],
  },
];

// ─── CRUD ──────────────────────────────────────────────────────────────────────

export const getNotes = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { subject, folder, tags, page = "1", limit = "20", search } = req.query;
    const filter: Record<string, unknown> = { userId: req.user!.userId };

    if (subject) filter.subject = subject;
    if (folder) filter.folder = folder;
    if (tags) filter.tags = { $in: (tags as string).split(",") };
    if (search) filter.$text = { $search: search as string };

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const [notes, total] = await Promise.all([
      Note.find(filter)
        .skip(skip)
        .limit(parseInt(limit as string))
        .sort({ updatedAt: -1 }),
      Note.countDocuments(filter),
    ]);

    sendSuccess(res, notes, "Notes retrieved", 200, { total });
  } catch (err) {
    sendError(res, "Failed to retrieve notes", 500, (err as Error).message);
  }
};

export const getNote = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const note = await Note.findOne({ _id: req.params.id, userId: req.user!.userId });
    if (!note) {
      sendNotFound(res, "Note not found");
      return;
    }
    sendSuccess(res, note, "Note retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve note", 500, (err as Error).message);
  }
};

export const createNote = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, content, subject, tags, source, sourceRef, folder, linkedDocumentId } = req.body;
    if (!title || !content) {
      sendBadRequest(res, "Title and content are required");
      return;
    }

    const note = await Note.create({
      userId: req.user!.userId,
      title,
      content,
      subject,
      tags,
      source,
      sourceRef,
      folder,
      linkedDocumentId,
    });

    await Progress.findOneAndUpdate(
      { userId: req.user!.userId, date: today() },
      { $inc: { notesCreated: 1 } },
      { upsert: true, new: true }
    );

    sendCreated(res, note, "Note created");
  } catch (err) {
    sendError(res, "Failed to create note", 500, (err as Error).message);
  }
};

export const updateNote = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const note = await Note.findOne({ _id: req.params.id, userId: req.user!.userId });
    if (!note) {
      sendNotFound(res, "Note not found");
      return;
    }

    Object.assign(note, req.body);
    await note.save();

    sendSuccess(res, note, "Note updated");
  } catch (err) {
    sendError(res, "Failed to update note", 500, (err as Error).message);
  }
};

export const deleteNote = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const note = await Note.findOneAndDelete({ _id: req.params.id, userId: req.user!.userId });
    if (!note) {
      sendNotFound(res, "Note not found");
      return;
    }
    sendSuccess(res, null, "Note deleted");
  } catch (err) {
    sendError(res, "Failed to delete note", 500, (err as Error).message);
  }
};

// ─── AI-Powered Note Features ──────────────────────────────────────────────────

export const analyzeNote = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const note = await Note.findOne({ _id: req.params.id, userId: req.user!.userId });
    if (!note) {
      sendNotFound(res, "Note not found");
      return;
    }

    const prompt = `Analyze this law student's note and return a JSON quality assessment:
{
  "qualityScore": <0-100>,
  "feedback": "<overall assessment>",
  "missingPrinciples": ["<missing key principle 1>", "..."],
  "missingCases": ["<case that should be referenced>", "..."],
  "structureSuggestions": ["<IRAC structure suggestion>", "..."],
  "strengths": ["<strength 1>", "..."],
  "autoTags": ["<suggested tag>", "..."]
}

NOTE TITLE: ${note.title}
NOTE CONTENT (plain text):
${note.content.replace(/<[^>]+>/g, "")}`;

    interface NoteAnalysis {
      qualityScore: number;
      feedback: string;
      missingPrinciples: string[];
      missingCases: string[];
      structureSuggestions: string[];
      strengths: string[];
      autoTags: string[];
    }

    const analysis = await deepseekService.structuredCompletion<NoteAnalysis>(prompt);

    note.qualityScore = analysis.qualityScore;
    note.qualityFeedback = analysis.feedback;
    await note.save();

    sendSuccess(res, analysis, "Note analyzed");
  } catch (err) {
    sendError(res, "Note analysis failed", 500, (err as Error).message);
  }
};

export const summarizeNote = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const note = await Note.findOne({ _id: req.params.id, userId: req.user!.userId });
    if (!note) {
      sendNotFound(res, "Note not found");
      return;
    }

    const plainText = note.content.replace(/<[^>]+>/g, "");
    const summary = await deepseekService.chat(
      `Summarize the following law note into concise bullet points covering the key legal principles, cases, and conclusions. Return only the summary.\n\nNOTE:\n${plainText}`,
      undefined,
      1500
    );

    sendSuccess(res, { summary }, "Note summarized");
  } catch (err) {
    sendError(res, "Note summarization failed", 500, (err as Error).message);
  }
};

export const expandNote = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const note = await Note.findOne({ _id: req.params.id, userId: req.user!.userId });
    if (!note) {
      sendNotFound(res, "Note not found");
      return;
    }

    const plainText = note.content.replace(/<[^>]+>/g, "");
    const expanded = await deepseekService.chat(
      `Expand the following brief law note with additional Nigerian legal context, relevant cases, statutory provisions, and deeper analysis. Preserve the original structure and add to it.\n\nNOTE:\n${plainText}`,
      undefined,
      3000
    );

    sendSuccess(res, { expanded }, "Note expanded");
  } catch (err) {
    sendError(res, "Note expansion failed", 500, (err as Error).message);
  }
};

export const getRelatedNotes = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const note = await Note.findOne({ _id: req.params.id, userId: req.user!.userId });
    if (!note) {
      sendNotFound(res, "Note not found");
      return;
    }

    // Find notes sharing tags or subject — simple semantic grouping without vector DB
    const filter: Record<string, unknown> = {
      userId: req.user!.userId,
      _id: { $ne: note._id },
    };

    if (note.tags?.length) {
      filter.tags = { $in: note.tags };
    } else if (note.subject) {
      filter.subject = note.subject;
    }

    const related = await Note.find(filter)
      .select("title subject tags folder qualityScore createdAt")
      .limit(10)
      .sort({ updatedAt: -1 });

    sendSuccess(res, related, "Related notes retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve related notes", 500, (err as Error).message);
  }
};

export const getTemplates = async (_req: AuthRequest, res: Response): Promise<void> => {
  sendSuccess(res, NOTE_TEMPLATES, "Templates retrieved");
};

export const getFolders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const folders = await Note.distinct("folder", { userId: req.user!.userId });
    sendSuccess(res, folders, "Folders retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve folders", 500, (err as Error).message);
  }
};
