import { Response } from "express";
import { AuthRequest } from "../types";
import { Question, QuestionAttempt } from "../models/Question";
import { gradingService } from "../services/ai/grading.service";
import { Progress } from "../models/Progress";
import { sendSuccess, sendCreated, sendNotFound, sendBadRequest, sendError } from "../utils/response";

const today = () => new Date().toISOString().split("T")[0];

export const getQuestions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { subject, difficulty, type, page = "1", limit = "10" } = req.query;
    const filter: Record<string, unknown> = { isActive: true };

    if (subject) filter.subject = subject;
    if (difficulty) filter.difficulty = difficulty;
    if (type) filter.type = type;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const [questions, total] = await Promise.all([
      Question.find(filter).skip(skip).limit(parseInt(limit as string)).sort({ createdAt: -1 }),
      Question.countDocuments(filter),
    ]);

    sendSuccess(res, questions, "Questions retrieved", 200, { total });
  } catch (err) {
    sendError(res, "Failed to retrieve questions", 500, (err as Error).message);
  }
};

export const getQuestion = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const question = await Question.findById(req.params.id);
    if (!question) { sendNotFound(res, "Question not found"); return; }
    sendSuccess(res, question, "Question retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve question", 500, (err as Error).message);
  }
};

export const getRandomQuestion = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { subject, difficulty, type } = req.query;
    const filter: Record<string, unknown> = { isActive: true };

    if (subject) filter.subject = subject;
    if (difficulty) filter.difficulty = difficulty;
    if (type) filter.type = type;

    const count = await Question.countDocuments(filter);
    if (count === 0) { sendNotFound(res, "No questions found for the given filters"); return; }

    const random = Math.floor(Math.random() * count);
    const question = await Question.findOne(filter).skip(random);

    sendSuccess(res, question, "Random question retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve random question", 500, (err as Error).message);
  }
};

export const submitAnswer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { answer } = req.body;
    if (!answer) { sendBadRequest(res, "Answer is required"); return; }

    const question = await Question.findById(req.params.id);
    if (!question) { sendNotFound(res, "Question not found"); return; }

    const result = await gradingService.gradeAnswer(
      question.prompt,
      answer,
      question.modelAnswer,
      question.gradingNotes
    );

    const attempt = await QuestionAttempt.create({
      userId: req.user!.userId,
      questionId: question._id,
      answer,
      scores: result.scores,
      aiFeedback: result.feedback.overall,
    });

    await Progress.findOneAndUpdate(
      { userId: req.user!.userId, date: today() },
      { $inc: { questionsAnswered: 1 } },
      { upsert: true, new: true }
    );

    sendCreated(res, { attempt, gradingResult: result }, "Answer graded");
  } catch (err) {
    sendError(res, "Answer submission failed", 500, (err as Error).message);
  }
};

export const getMyAttempts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = "1", limit = "20" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const [attempts, total] = await Promise.all([
      QuestionAttempt.find({ userId: req.user!.userId })
        .populate("questionId", "type subject difficulty prompt")
        .skip(skip)
        .limit(parseInt(limit as string))
        .sort({ createdAt: -1 }),
      QuestionAttempt.countDocuments({ userId: req.user!.userId }),
    ]);

    sendSuccess(res, attempts, "Attempts retrieved", 200, { total });
  } catch (err) {
    sendError(res, "Failed to retrieve attempts", 500, (err as Error).message);
  }
};

export const getQuestionAttempts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const attempts = await QuestionAttempt.find({
      userId: req.user!.userId,
      questionId: req.params.id,
    }).sort({ createdAt: -1 });

    sendSuccess(res, attempts, "Question attempts retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve question attempts", 500, (err as Error).message);
  }
};

export const getStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;

    const attempts = await QuestionAttempt.find({ userId })
      .populate<{ questionId: { subject: string; difficulty: string; type: string } }>(
        "questionId",
        "subject difficulty type"
      );

    const total = attempts.length;
    const averageScore = total > 0
      ? Math.round(attempts.reduce((sum, a) => sum + a.scores.total, 0) / total)
      : 0;

    const bySubject: Record<string, { count: number; avgScore: number }> = {};
    const byDifficulty: Record<string, number> = {};
    const byType: Record<string, number> = {};

    attempts.forEach((a) => {
      const q = a.questionId as { subject?: string; difficulty?: string; type?: string };
      if (q?.subject) {
        if (!bySubject[q.subject]) bySubject[q.subject] = { count: 0, avgScore: 0 };
        bySubject[q.subject].count += 1;
        bySubject[q.subject].avgScore += a.scores.total;
      }
      if (q?.difficulty) byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] ?? 0) + 1;
      if (q?.type) byType[q.type] = (byType[q.type] ?? 0) + 1;
    });

    // Finalize averages
    Object.keys(bySubject).forEach((s) => {
      bySubject[s].avgScore = Math.round(bySubject[s].avgScore / bySubject[s].count);
    });

    sendSuccess(res, { total, averageScore, bySubject, byDifficulty, byType }, "Stats retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve stats", 500, (err as Error).message);
  }
};
