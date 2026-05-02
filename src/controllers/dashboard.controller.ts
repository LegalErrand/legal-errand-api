import { Response } from "express";
import { AuthRequest } from "../types";
import { Progress, ReasoningScore } from "../models/Progress";
import { QuestionAttempt } from "../models/Question";
import { Note } from "../models/Note";
import { redisService } from "../services/cache/redis.service";
import { CACHE_TTL, REDIS_KEYS } from "../utils/constants";
import { sendSuccess, sendError } from "../utils/response";

export const getDashboard = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const cacheKey = REDIS_KEYS.DASHBOARD_CACHE(userId);
    const cached = await redisService.get(cacheKey);
    if (cached) { sendSuccess(res, cached, "Dashboard (cached)"); return; }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      recentProgress,
      latestScore,
      recentAttempts,
      totalNotes,
    ] = await Promise.all([
      Progress.find({ userId, createdAt: { $gte: thirtyDaysAgo } }).sort({ date: 1 }),
      ReasoningScore.findOne({ userId }).sort({ calculatedAt: -1 }),
      QuestionAttempt.find({ userId }).sort({ createdAt: -1 }).limit(10),
      Note.countDocuments({ userId }),
    ]);

    // Build streak calendar
    const studiedDates = new Set(recentProgress.map((p) => p.date));
    const streakData = buildStreakData(studiedDates);

    // Subject mastery from attempts
    const subjectScores = computeSubjectScores(recentAttempts);

    // Weak areas
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildStreakData(studiedDates: Set<string>) {
  const today = new Date().toISOString().split("T")[0];
  let current = 0;
  let longest = 0;
  let tempStreak = 0;

  const sorted = Array.from(studiedDates).sort();
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) { tempStreak = 1; continue; }
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
    tempStreak = diff === 1 ? tempStreak + 1 : 1;
    longest = Math.max(longest, tempStreak);
  }

  current = studiedDates.has(today) ? tempStreak : 0;

  return { current, longest, datesStudied: Array.from(studiedDates) };
}

function computeSubjectScores(attempts: InstanceType<typeof QuestionAttempt>[]): Record<string, number> {
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
