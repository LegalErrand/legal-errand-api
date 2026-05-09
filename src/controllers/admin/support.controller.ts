import { Response } from "express";
import { AdminRequest } from "../../types";
import { User } from "../../models/User";
import { Note } from "../../models/Note";
import { QuestionAttempt } from "../../models/Question";
import { ResearchSession } from "../../models/ResearchSession";
import { CaseExplanation } from "../../models/CaseExplanation";
import { Conversation } from "../../models/Conversation";
import { Progress } from "../../models/Progress";
import { ReasoningScore } from "../../models/Progress";
import { sendSuccess, sendNotFound, sendError } from "../../utils/response";

export const getUserProfile = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.params.id)
      .populate("referredBy", "firstName lastName email");

    if (!user) {
      sendNotFound(res, "User not found");
      return;
    }

    const [
      referredCount,
      noteCount,
      attemptCount,
      researchCount,
      caseCount,
      conversationCount,
      latestScore,
    ] = await Promise.all([
      User.countDocuments({ referredBy: user._id }),
      Note.countDocuments({ userId: user._id }),
      QuestionAttempt.countDocuments({ userId: user._id }),
      ResearchSession.countDocuments({ userId: user._id }),
      CaseExplanation.countDocuments({ userId: user._id }),
      Conversation.countDocuments({ userId: user._id }),
      ReasoningScore.findOne({ userId: user._id }).sort({ calculatedAt: -1 }),
    ]);

    sendSuccess(res, {
      user,
      stats: {
        referredCount,
        noteCount,
        attemptCount,
        researchCount,
        caseCount,
        conversationCount,
        latestReasoningScore: latestScore?.overall ?? null,
      },
    }, "User profile retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve user profile", 500, (err as Error).message);
  }
};

export const getUserActivity = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { page = "1", limit = "30" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const user = await User.findById(req.params.id).select("_id");
    if (!user) {
      sendNotFound(res, "User not found");
      return;
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [attempts, cases, research, conversations] = await Promise.all([
      QuestionAttempt.find({ userId: user._id, createdAt: { $gte: thirtyDaysAgo } })
        .populate("questionId", "subject difficulty type")
        .sort({ createdAt: -1 })
        .limit(20),
      CaseExplanation.find({ userId: user._id, createdAt: { $gte: thirtyDaysAgo } })
        .select("citation facts createdAt")
        .sort({ createdAt: -1 })
        .limit(20),
      ResearchSession.find({ userId: user._id, createdAt: { $gte: thirtyDaysAgo } })
        .select("query refinedQuery qualityScore createdAt")
        .sort({ createdAt: -1 })
        .limit(20),
      Conversation.find({ userId: user._id, createdAt: { $gte: thirtyDaysAgo } })
        .select("title mode messageCount lastMessage createdAt")
        .sort({ createdAt: -1 })
        .limit(20),
    ]);

    const recentProgress = await Progress.find({ userId: user._id })
      .sort({ date: -1 })
      .limit(30)
      .skip(skip);

    sendSuccess(res, {
      recentProgress,
      recentAttempts: attempts,
      recentCaseExplanations: cases,
      recentResearch: research,
      recentConversations: conversations,
    }, "User activity retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve user activity", 500, (err as Error).message);
  }
};

export const getUserNotes = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { page = "1", limit = "20" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const user = await User.findById(req.params.id).select("_id");
    if (!user) { sendNotFound(res, "User not found"); return; }

    const [notes, total] = await Promise.all([
      Note.find({ userId: user._id }).skip(skip).limit(parseInt(limit as string)).sort({ createdAt: -1 }),
      Note.countDocuments({ userId: user._id }),
    ]);

    sendSuccess(res, notes, "Notes retrieved", 200, {
      page: parseInt(page as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    });
  } catch (err) {
    sendError(res, "Failed to retrieve notes", 500, (err as Error).message);
  }
};

export const getUserAttempts = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { page = "1", limit = "20" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const user = await User.findById(req.params.id).select("_id");
    if (!user) { sendNotFound(res, "User not found"); return; }

    const [attempts, total] = await Promise.all([
      QuestionAttempt.find({ userId: user._id })
        .populate("questionId", "subject difficulty type prompt")
        .skip(skip)
        .limit(parseInt(limit as string))
        .sort({ createdAt: -1 }),
      QuestionAttempt.countDocuments({ userId: user._id }),
    ]);

    sendSuccess(res, attempts, "Attempts retrieved", 200, {
      page: parseInt(page as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    });
  } catch (err) {
    sendError(res, "Failed to retrieve attempts", 500, (err as Error).message);
  }
};

export const getUserResearch = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { page = "1", limit = "20" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const user = await User.findById(req.params.id).select("_id");
    if (!user) { sendNotFound(res, "User not found"); return; }

    const [sessions, total] = await Promise.all([
      ResearchSession.find({ userId: user._id })
        .skip(skip)
        .limit(parseInt(limit as string))
        .sort({ createdAt: -1 }),
      ResearchSession.countDocuments({ userId: user._id }),
    ]);

    sendSuccess(res, sessions, "Research sessions retrieved", 200, {
      page: parseInt(page as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    });
  } catch (err) {
    sendError(res, "Failed to retrieve research sessions", 500, (err as Error).message);
  }
};
