import { Response } from "express";
import { AuthRequest } from "../types";
import { Note } from "../models/Note";
import { deepseekService } from "../services/ai/deepseek.service";
import { Progress } from "../models/Progress";
import { sendSuccess, sendCreated, sendNotFound, sendBadRequest, sendError } from "../utils/response";

const today = () => new Date().toISOString().split("T")[0];

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
      Note.find(filter).skip(skip).limit(parseInt(limit as string)).sort({ updatedAt: -1 }),
      Note.countDocuments(filter),
    ]);

    sendSuccess(res, notes, "Notes retrieved", 200, { total });
  } catch (err) {
    sendError(res, "Failed to retrieve notes", 500, (err as Error).message);
  }
};

export const createNote = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, content, subject, tags, source, sourceRef, folder, linkedDocumentId } = req.body;
    if (!title || !content) { sendBadRequest(res, "Title and content are required"); return; }

    const note = await Note.create({
      userId: req.user!.userId,
      title, content, subject, tags, source, sourceRef, folder, linkedDocumentId,
    });

    // Track activity
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
    if (!note) { sendNotFound(res, "Note not found"); return; }

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
    if (!note) { sendNotFound(res, "Note not found"); return; }
    sendSuccess(res, null, "Note deleted");
  } catch (err) {
    sendError(res, "Failed to delete note", 500, (err as Error).message);
  }
};

export const analyzeNote = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const note = await Note.findOne({ _id: req.params.id, userId: req.user!.userId });
    if (!note) { sendNotFound(res, "Note not found"); return; }

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

    // Persist quality score back to note
    note.qualityScore = analysis.qualityScore;
    note.qualityFeedback = analysis.feedback;
    await note.save();

    sendSuccess(res, analysis, "Note analyzed");
  } catch (err) {
    sendError(res, "Note analysis failed", 500, (err as Error).message);
  }
};

export const getFolders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const folders = await Note.distinct("folder", { userId: req.user!.userId });
    sendSuccess(res, folders, "Folders retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve folders", 500, (err as Error).message);
  }
};
