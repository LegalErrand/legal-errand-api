import { Response } from "express";
import { AdminRequest } from "../../types";
import { Question, QuestionAttempt } from "../../models/Question";
import { LAW_SUBJECTS, DIFFICULTY_LEVELS, QUESTION_TYPES } from "../../utils/constants";
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendError,
} from "../../utils/response";

export const listQuestions = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { page = "1", limit = "20", subject, difficulty, type, isActive, search } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const filter: Record<string, unknown> = {};
    if (subject) filter.subject = subject;
    if (difficulty) filter.difficulty = difficulty;
    if (type) filter.type = type;
    if (isActive !== undefined) filter.isActive = isActive === "true";
    if (search) filter.$text = { $search: search as string };

    const [questions, total] = await Promise.all([
      Question.find(filter)
        .skip(skip)
        .limit(parseInt(limit as string))
        .sort({ createdAt: -1 }),
      Question.countDocuments(filter),
    ]);

    sendSuccess(res, questions, "Questions retrieved", 200, {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    });
  } catch (err) {
    sendError(res, "Failed to list questions", 500, (err as Error).message);
  }
};

export const getQuestion = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const question = await Question.findById(req.params.id);
    if (!question) {
      sendNotFound(res, "Question not found");
      return;
    }

    const [attemptCount, avgScore] = await Promise.all([
      QuestionAttempt.countDocuments({ questionId: req.params.id }),
      QuestionAttempt.aggregate([
        { $match: { questionId: question._id } },
        { $group: { _id: null, avg: { $avg: "$scores.total" } } },
      ]),
    ]);

    sendSuccess(
      res,
      {
        ...question.toJSON(),
        stats: { attemptCount, avgScore: avgScore[0]?.avg ?? null },
      },
      "Question retrieved"
    );
  } catch (err) {
    sendError(res, "Failed to retrieve question", 500, (err as Error).message);
  }
};

export const createQuestion = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { type, subject, difficulty, prompt, modelAnswer, gradingNotes, tags } = req.body;

    if (!type || !subject || !difficulty || !prompt) {
      sendBadRequest(res, "type, subject, difficulty, and prompt are required");
      return;
    }
    if (!QUESTION_TYPES.includes(type)) {
      sendBadRequest(res, `type must be one of: ${QUESTION_TYPES.join(", ")}`);
      return;
    }
    if (!LAW_SUBJECTS.includes(subject)) {
      sendBadRequest(res, `subject must be one of: ${LAW_SUBJECTS.join(", ")}`);
      return;
    }
    if (!DIFFICULTY_LEVELS.includes(difficulty)) {
      sendBadRequest(res, `difficulty must be one of: ${DIFFICULTY_LEVELS.join(", ")}`);
      return;
    }

    const question = await Question.create({
      type,
      subject,
      difficulty,
      prompt,
      modelAnswer,
      gradingNotes,
      tags: tags || [],
    });

    sendCreated(res, question, "Question created");
  } catch (err) {
    sendError(res, "Failed to create question", 500, (err as Error).message);
  }
};

export const updateQuestion = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const ALLOWED = [
      "type",
      "subject",
      "difficulty",
      "prompt",
      "modelAnswer",
      "gradingNotes",
      "tags",
      "isActive",
    ];
    const updates: Record<string, unknown> = {};

    for (const field of ALLOWED) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (Object.keys(updates).length === 0) {
      sendBadRequest(res, "No valid fields provided");
      return;
    }

    if (updates.type && !QUESTION_TYPES.includes(updates.type as never)) {
      sendBadRequest(res, `type must be one of: ${QUESTION_TYPES.join(", ")}`);
      return;
    }
    if (updates.subject && !LAW_SUBJECTS.includes(updates.subject as never)) {
      sendBadRequest(res, `subject must be one of: ${LAW_SUBJECTS.join(", ")}`);
      return;
    }
    if (updates.difficulty && !DIFFICULTY_LEVELS.includes(updates.difficulty as never)) {
      sendBadRequest(res, `difficulty must be one of: ${DIFFICULTY_LEVELS.join(", ")}`);
      return;
    }

    const question = await Question.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!question) {
      sendNotFound(res, "Question not found");
      return;
    }

    sendSuccess(res, question, "Question updated");
  } catch (err) {
    sendError(res, "Failed to update question", 500, (err as Error).message);
  }
};

export const toggleQuestion = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const question = await Question.findById(req.params.id);
    if (!question) {
      sendNotFound(res, "Question not found");
      return;
    }

    question.isActive = !question.isActive;
    await question.save();

    sendSuccess(res, question, question.isActive ? "Question activated" : "Question deactivated");
  } catch (err) {
    sendError(res, "Failed to toggle question", 500, (err as Error).message);
  }
};

export const deleteQuestion = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const question = await Question.findByIdAndDelete(req.params.id);
    if (!question) {
      sendNotFound(res, "Question not found");
      return;
    }

    sendSuccess(res, null, "Question deleted");
  } catch (err) {
    sendError(res, "Failed to delete question", 500, (err as Error).message);
  }
};

export const bulkImportQuestions = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { questions } = req.body;

    if (!Array.isArray(questions) || questions.length === 0) {
      sendBadRequest(res, "questions must be a non-empty array");
      return;
    }
    if (questions.length > 100) {
      sendBadRequest(res, "Maximum 100 questions per bulk import");
      return;
    }

    for (const [i, q] of questions.entries()) {
      if (!q.type || !q.subject || !q.difficulty || !q.prompt) {
        sendBadRequest(res, `questions[${i}]: type, subject, difficulty, and prompt are required`);
        return;
      }
      if (!QUESTION_TYPES.includes(q.type)) {
        sendBadRequest(res, `questions[${i}]: invalid type "${q.type}"`);
        return;
      }
      if (!LAW_SUBJECTS.includes(q.subject)) {
        sendBadRequest(res, `questions[${i}]: invalid subject "${q.subject}"`);
        return;
      }
      if (!DIFFICULTY_LEVELS.includes(q.difficulty)) {
        sendBadRequest(res, `questions[${i}]: invalid difficulty "${q.difficulty}"`);
        return;
      }
    }

    const created = await Question.insertMany(
      questions.map((q) => ({
        type: q.type,
        subject: q.subject,
        difficulty: q.difficulty,
        prompt: q.prompt,
        modelAnswer: q.modelAnswer,
        gradingNotes: q.gradingNotes,
        tags: q.tags || [],
      }))
    );

    sendCreated(
      res,
      { questions: created, count: created.length },
      "Questions imported successfully"
    );
  } catch (err) {
    sendError(res, "Bulk import failed", 500, (err as Error).message);
  }
};
