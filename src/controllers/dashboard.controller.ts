import { Response } from "express";
import { AuthRequest } from "../types";
import { Progress, ReasoningScore } from "../models/Progress";
import { QuestionAttempt } from "../models/Question";
import { Note } from "../models/Note";
import { CaseExplanation } from "../models/CaseExplanation";
import { Conversation } from "../models/Conversation";
import { ResearchSession } from "../models/ResearchSession";
import { Goal } from "../models/Goal";
import { User } from "../models/User";
import { deepseekService } from "../services/ai/deepseek.service";
import { redisService } from "../services/cache/redis.service";
import { CACHE_TTL, REDIS_KEYS } from "../utils/constants";
import {
  sendSuccess,
  sendCreated,
  sendNotFound,
  sendBadRequest,
  sendError,
} from "../utils/response";

// ─── Dashboard ─────────────────────────────────────────────────────────────────

export const getDashboard = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const cacheKey = REDIS_KEYS.DASHBOARD_CACHE(userId);
    const cached = await redisService.get(cacheKey);
    if (cached) {
      sendSuccess(res, cached, "Dashboard (cached)");
      return;
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [recentProgress, latestScore, recentAttempts, totalNotes, activeGoals] =
      await Promise.all([
        Progress.find({ userId, createdAt: { $gte: thirtyDaysAgo } }).sort({ date: 1 }),
        ReasoningScore.findOne({ userId }).sort({ calculatedAt: -1 }),
        QuestionAttempt.find({ userId }).sort({ createdAt: -1 }).limit(10),
        Note.countDocuments({ userId }),
        Goal.find({ userId, isCompleted: false }).sort({ deadline: 1 }).limit(3),
      ]);

    const studiedDates = new Set(recentProgress.map((p) => p.date));
    const streakData = buildStreakData(studiedDates);
    const subjectScores = computeSubjectScores(
      recentAttempts as unknown as InstanceType<typeof QuestionAttempt>[]
    );
    const weakAreas = Object.entries(subjectScores)
      .filter(([, score]) => score < 60)
      .map(([subject]) => subject);

    const dashboard = {
      streak: streakData,
      stats: {
        totalStudyDays: studiedDates.size,
        totalNotes,
        questionsAnswered: recentAttempts.length,
        lastActive: recentProgress[recentProgress.length - 1]?.date ?? null,
      },
      reasoningScore: latestScore,
      subjectMastery: subjectScores,
      weakAreas,
      recentActivity: recentProgress.slice(-7),
      activeGoals,
    };

    await redisService.set(cacheKey, dashboard, CACHE_TTL.DASHBOARD);
    sendSuccess(res, dashboard, "Dashboard retrieved");
  } catch (err) {
    sendError(res, "Failed to load dashboard", 500, (err as Error).message);
  }
};

export const getStreak = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const allProgress = await Progress.find({ userId: req.user!.userId }).sort({ date: 1 });
    const studiedDates = new Set(allProgress.map((p) => p.date));
    sendSuccess(res, buildStreakData(studiedDates), "Streak retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve streak", 500, (err as Error).message);
  }
};

// ─── Activity History ──────────────────────────────────────────────────────────

export const getActivity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { type, page = "1", limit = "20", search } = req.query;
    const userId = req.user!.userId;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const lim = parseInt(limit as string);

    type ActivityItem = {
      _id: string;
      type: string;
      title: string;
      subtitle: string;
      createdAt: Date;
    };

    let items: ActivityItem[] = [];
    let total = 0;

    if (!type || type === "all" || type === "quizzes") {
      const attempts = await QuestionAttempt.find({ userId })
        .populate<{
          questionId: { prompt: string; subject: string };
        }>("questionId", "prompt subject")
        .sort({ createdAt: -1 });

      const quizItems: ActivityItem[] = attempts.map((a) => ({
        _id: a._id.toString(),
        type: "quiz",
        title: (a.questionId as { prompt?: string })?.prompt?.slice(0, 80) ?? "Quiz question",
        subtitle: `Score: ${a.scores.total}/100 · ${(a.questionId as { subject?: string })?.subject ?? ""}`,
        createdAt: (a as unknown as { createdAt: Date }).createdAt,
      }));
      items = items.concat(quizItems);
    }

    if (!type || type === "all" || type === "documents") {
      const cases = await CaseExplanation.find({ userId }).sort({ createdAt: -1 });
      const caseItems: ActivityItem[] = cases.map((c) => ({
        _id: c._id.toString(),
        type: "case",
        title: c.citation || "Case explanation",
        subtitle: "Case summary",
        createdAt: (c as unknown as { createdAt: Date }).createdAt,
      }));
      items = items.concat(caseItems);
    }

    if (!type || type === "all" || type === "ai_sessions") {
      const convos = await Conversation.find({ userId }).sort({ updatedAt: -1 });
      const convoItems: ActivityItem[] = convos.map((c) => ({
        _id: c._id.toString(),
        type: c.mode === "socratic" ? "socratic" : "ai_session",
        title: c.title,
        subtitle: `${c.messageCount} messages · ${c.mode}`,
        createdAt: (c as unknown as { updatedAt: Date }).updatedAt,
      }));
      items = items.concat(convoItems);
    }

    // Sort all by date, apply search filter, then paginate
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (search) {
      const q = (search as string).toLowerCase();
      items = items.filter(
        (i) => i.title.toLowerCase().includes(q) || i.subtitle.toLowerCase().includes(q)
      );
    }

    total = items.length;
    const paginated = items.slice(skip, skip + lim);

    sendSuccess(res, paginated, "Activity retrieved", 200, {
      total,
      page: parseInt(page as string),
      totalPages: Math.ceil(total / lim),
    });
  } catch (err) {
    sendError(res, "Failed to retrieve activity", 500, (err as Error).message);
  }
};

// ─── Achievements / Badges ─────────────────────────────────────────────────────

export const getAchievements = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;

    const [user, totalAttempts, totalCases, totalNotes, totalResearch, allProgress] =
      await Promise.all([
        User.findById(userId),
        QuestionAttempt.countDocuments({ userId }),
        CaseExplanation.countDocuments({ userId }),
        Note.countDocuments({ userId }),
        ResearchSession.countDocuments({ userId }),
        Progress.find({ userId }).sort({ date: 1 }),
      ]);

    const studiedDates = new Set(allProgress.map((p) => p.date));
    const { current: currentStreak, longest: longestStreak } = buildStreakData(studiedDates);

    const badges = [
      // Streak badges
      { id: "streak_3", name: "3-Day Streak", category: "streak", earned: longestStreak >= 3 },
      { id: "streak_7", name: "7-Day Streak", category: "streak", earned: longestStreak >= 7 },
      { id: "streak_14", name: "14-Day Streak", category: "streak", earned: longestStreak >= 14 },
      { id: "streak_30", name: "30-Day Streak", category: "streak", earned: longestStreak >= 30 },
      { id: "streak_60", name: "60-Day Streak", category: "streak", earned: longestStreak >= 60 },
      {
        id: "streak_100",
        name: "100-Day Streak",
        category: "streak",
        earned: longestStreak >= 100,
      },
      // Quiz badges
      { id: "quiz_10", name: "Quiz Starter", category: "quiz", earned: totalAttempts >= 10 },
      { id: "quiz_50", name: "Quiz Pro", category: "quiz", earned: totalAttempts >= 50 },
      { id: "quiz_100", name: "Quiz Master", category: "quiz", earned: totalAttempts >= 100 },
      // Learning badges
      { id: "case_10", name: "Case Analyst", category: "learning", earned: totalCases >= 10 },
      { id: "case_50", name: "Case Expert", category: "learning", earned: totalCases >= 50 },
      { id: "note_10", name: "Note Taker", category: "learning", earned: totalNotes >= 10 },
      { id: "note_100", name: "Note Master", category: "learning", earned: totalNotes >= 100 },
      // Research badges
      { id: "research_10", name: "Researcher", category: "research", earned: totalResearch >= 10 },
      {
        id: "research_50",
        name: "Research Pro",
        category: "research",
        earned: totalResearch >= 50,
      },
      // Special
      { id: "early_adopter", name: "Early Adopter", category: "special", earned: true },
      {
        id: "referral_1",
        name: "Referral Champion",
        category: "special",
        earned: !!user?.referredBy,
      },
    ];

    const earned = badges.filter((b) => b.earned);
    sendSuccess(
      res,
      { badges, earned: earned.length, total: badges.length, currentStreak },
      "Achievements retrieved"
    );
  } catch (err) {
    sendError(res, "Failed to retrieve achievements", 500, (err as Error).message);
  }
};

// ─── Goals ─────────────────────────────────────────────────────────────────────

export const getGoals = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status } = req.query;
    const filter: Record<string, unknown> = { userId: req.user!.userId };
    if (status === "active") filter.isCompleted = false;
    if (status === "completed") filter.isCompleted = true;

    const goals = await Goal.find(filter).sort({ deadline: 1, createdAt: -1 });
    sendSuccess(res, goals, "Goals retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve goals", 500, (err as Error).message);
  }
};

export const createGoal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, description, targetValue, unit, deadline } = req.body;
    if (!title || !targetValue || !unit) {
      sendBadRequest(res, "title, targetValue, and unit are required");
      return;
    }

    const goal = await Goal.create({
      userId: req.user!.userId,
      title,
      description,
      targetValue,
      unit,
      deadline: deadline ? new Date(deadline) : undefined,
    });

    sendCreated(res, goal, "Goal created");
  } catch (err) {
    sendError(res, "Failed to create goal", 500, (err as Error).message);
  }
};

export const updateGoal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const goal = await Goal.findOne({ _id: req.params.id, userId: req.user!.userId });
    if (!goal) {
      sendNotFound(res, "Goal not found");
      return;
    }

    const { title, description, targetValue, currentValue, deadline, isCompleted } = req.body;
    if (title !== undefined) goal.title = title;
    if (description !== undefined) goal.description = description;
    if (targetValue !== undefined) goal.targetValue = targetValue;
    if (currentValue !== undefined) goal.currentValue = currentValue;
    if (deadline !== undefined) goal.deadline = new Date(deadline);
    if (isCompleted !== undefined) {
      goal.isCompleted = isCompleted;
      if (isCompleted && !goal.completedAt) goal.completedAt = new Date();
    }

    await goal.save();
    sendSuccess(res, goal, "Goal updated");
  } catch (err) {
    sendError(res, "Failed to update goal", 500, (err as Error).message);
  }
};

export const deleteGoal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const goal = await Goal.findOneAndDelete({ _id: req.params.id, userId: req.user!.userId });
    if (!goal) {
      sendNotFound(res, "Goal not found");
      return;
    }
    sendSuccess(res, null, "Goal deleted");
  } catch (err) {
    sendError(res, "Failed to delete goal", 500, (err as Error).message);
  }
};

// ─── AI Insights ──────────────────────────────────────────────────────────────

export const getInsights = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const cacheKey = `insights:${userId}`;
    const cached = await redisService.get(cacheKey);
    if (cached) {
      sendSuccess(res, cached, "Insights (cached)");
      return;
    }

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [recentProgress, recentAttempts, totalNotes] = await Promise.all([
      Progress.find({ userId, createdAt: { $gte: sevenDaysAgo } }).sort({ date: 1 }),
      QuestionAttempt.find({ userId, createdAt: { $gte: sevenDaysAgo } }).populate<{
        questionId: { subject: string };
      }>("questionId", "subject"),
      Note.countDocuments({ userId }),
    ]);

    const subjectScores = computeSubjectScores(
      recentAttempts as unknown as InstanceType<typeof QuestionAttempt>[]
    );
    const studyDays = recentProgress.length;
    const totalQuestions = recentAttempts.length;
    const weakSubjects = Object.entries(subjectScores)
      .filter(([, s]) => s < 60)
      .map(([sub]) => sub);

    const prompt = `Generate 3 short, personalized study insights for a Nigerian law student with the following activity data. Each insight should be actionable and specific. Return JSON:
{
  "insights": [
    { "type": "encouragement|warning|recommendation", "message": "<insight>" }
  ]
}

Data:
- Study days this week: ${studyDays}/7
- Questions answered: ${totalQuestions}
- Total notes: ${totalNotes}
- Weak subjects (score < 60%): ${weakSubjects.join(", ") || "none"}
- Subject scores: ${JSON.stringify(subjectScores)}`;

    const result = await deepseekService.structuredCompletion<{
      insights: { type: string; message: string }[];
    }>(prompt);

    await redisService.set(cacheKey, result, 3600); // Cache for 1 hour
    sendSuccess(res, result, "Insights retrieved");
  } catch (err) {
    sendError(res, "Failed to generate insights", 500, (err as Error).message);
  }
};

// ─── Reasoning Score ───────────────────────────────────────────────────────────

export const getReasoningScore = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;

    const [latestScore, scoreHistory] = await Promise.all([
      ReasoningScore.findOne({ userId }).sort({ calculatedAt: -1 }),
      ReasoningScore.find({ userId })
        .sort({ calculatedAt: -1 })
        .limit(10)
        .select("overall calculatedAt"),
    ]);

    sendSuccess(res, { latest: latestScore, history: scoreHistory }, "Reasoning score retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve reasoning score", 500, (err as Error).message);
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildStreakData(studiedDates: Set<string>) {
  const today = new Date().toISOString().split("T")[0];
  let longest = 0;
  let tempStreak = 0;

  const sorted = Array.from(studiedDates).sort();
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) {
      tempStreak = 1;
      continue;
    }
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
    tempStreak = diff === 1 ? tempStreak + 1 : 1;
    longest = Math.max(longest, tempStreak);
  }
  if (sorted.length === 1) longest = 1;

  const current = studiedDates.has(today) ? tempStreak : 0;
  return { current, longest, datesStudied: Array.from(studiedDates) };
}

function computeSubjectScores(
  attempts: InstanceType<typeof QuestionAttempt>[]
): Record<string, number> {
  const bySubject: Record<string, number[]> = {};

  attempts.forEach((a) => {
    const q = (a as unknown as { questionId: { subject?: string } }).questionId;
    if (q?.subject) {
      if (!bySubject[q.subject]) bySubject[q.subject] = [];
      bySubject[q.subject].push(a.scores.total);
    }
  });

  return Object.fromEntries(
    Object.entries(bySubject).map(([subject, scores]) => [
      subject,
      Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    ])
  );
}
