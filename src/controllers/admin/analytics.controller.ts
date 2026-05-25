import { Response } from "express";
import { AdminRequest } from "../../types";
import { User } from "../../models/User";
import { LibraryDocument } from "../../models/Document";
import { Question, QuestionAttempt } from "../../models/Question";
import { ResearchSession } from "../../models/ResearchSession";
import { Conversation } from "../../models/Conversation";
import { Progress } from "../../models/Progress";
import { CaseExplanation } from "../../models/CaseExplanation";
import { Waitlist } from "../../models/Waitlist";
import { sendSuccess, sendError } from "../../utils/response";

export const getOverview = async (_req: AdminRequest, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers30d,
      activeUsers7d,
      newUsersToday,
      verifiedUsers,
      premiumUsers,
      blockedUsers,
      totalDocuments,
      libraryDocuments,
      userUploads,
      totalQuestions,
      activeQuestions,
      totalAttempts,
      attemptsToday,
      totalResearchSessions,
      totalConversations,
      totalCaseExplanations,
      totalWaitlist,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ lastLogin: { $gte: thirtyDaysAgo } }),
      User.countDocuments({ lastLogin: { $gte: sevenDaysAgo } }),
      User.countDocuments({ createdAt: { $gte: todayStart } }),
      User.countDocuments({ isEmailVerified: true }),
      User.countDocuments({ tier: "premium" }),
      User.countDocuments({ isBlocked: true }),
      LibraryDocument.countDocuments(),
      LibraryDocument.countDocuments({ isLibraryContent: true }),
      LibraryDocument.countDocuments({ isLibraryContent: false }),
      Question.countDocuments(),
      Question.countDocuments({ isActive: true }),
      QuestionAttempt.countDocuments(),
      QuestionAttempt.countDocuments({ createdAt: { $gte: todayStart } }),
      ResearchSession.countDocuments(),
      Conversation.countDocuments(),
      CaseExplanation.countDocuments(),
      Waitlist.countDocuments(),
    ]);

    sendSuccess(
      res,
      {
        users: {
          total: totalUsers,
          activeThisMonth: activeUsers30d,
          activeThisWeek: activeUsers7d,
          newToday: newUsersToday,
          verified: verifiedUsers,
          premium: premiumUsers,
          blocked: blockedUsers,
          conversionRate:
            totalUsers > 0 ? ((premiumUsers / totalUsers) * 100).toFixed(1) + "%" : "0%",
        },
        content: {
          totalDocuments,
          libraryDocuments,
          userUploads,
          totalQuestions,
          activeQuestions,
        },
        activity: {
          totalQuestionAttempts: totalAttempts,
          attemptsToday,
          totalResearchSessions,
          totalAiConversations: totalConversations,
          totalCaseExplanations,
        },
        waitlist: { total: totalWaitlist },
      },
      "Platform overview retrieved"
    );
  } catch (err) {
    sendError(res, "Failed to retrieve overview", 500, (err as Error).message);
  }
};

export const getUserGrowth = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { period = "30d" } = req.query;

    const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const growth = await User.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { date: "$_id", count: 1, _id: 0 } },
    ]);

    const byAccountType = await User.aggregate([
      { $group: { _id: "$accountType", count: { $sum: 1 } } },
    ]);

    const byTier = await User.aggregate([{ $group: { _id: "$tier", count: { $sum: 1 } } }]);

    const byCountry = await User.aggregate([
      { $match: { country: { $exists: true, $ne: null } } },
      { $group: { _id: "$country", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    sendSuccess(res, { period, growth, byAccountType, byTier, byCountry }, "User growth retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve user growth", 500, (err as Error).message);
  }
};

export const getUsageStats = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { period = "30d" } = req.query;
    const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const dateStr = since.toISOString().split("T")[0];

    const [dailyProgress, topStudyStreaks, avgScores] = await Promise.all([
      Progress.aggregate([
        { $match: { date: { $gte: dateStr } } },
        {
          $group: {
            _id: "$date",
            totalStudyMinutes: { $sum: "$studyMinutes" },
            totalAiQueries: { $sum: "$aiQueriesCount" },
            totalCasesExplained: { $sum: "$casesExplained" },
            totalNotesCreated: { $sum: "$notesCreated" },
            totalQuestionsAnswered: { $sum: "$questionsAnswered" },
            totalResearchSessions: { $sum: "$researchSessions" },
            activeUsers: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            date: "$_id",
            _id: 0,
            totalStudyMinutes: 1,
            totalAiQueries: 1,
            totalCasesExplained: 1,
            totalNotesCreated: 1,
            totalQuestionsAnswered: 1,
            totalResearchSessions: 1,
            activeUsers: 1,
          },
        },
      ]),
      User.find({ studyStreak: { $gt: 0 } })
        .select("firstName lastName email studyStreak")
        .sort({ studyStreak: -1 })
        .limit(10),
      QuestionAttempt.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: null,
            avgTotal: { $avg: "$scores.total" },
            avgIssue: { $avg: "$scores.issueIdentification" },
            avgRule: { $avg: "$scores.ruleStatement" },
            avgApplication: { $avg: "$scores.application" },
            avgConclusion: { $avg: "$scores.conclusion" },
          },
        },
      ]),
    ]);

    sendSuccess(
      res,
      {
        period,
        daily: dailyProgress,
        topStudyStreaks,
        avgQuestionScores: avgScores[0] || null,
      },
      "Usage stats retrieved"
    );
  } catch (err) {
    sendError(res, "Failed to retrieve usage stats", 500, (err as Error).message);
  }
};

export const getSubjectStats = async (_req: AdminRequest, res: Response): Promise<void> => {
  try {
    const [questionsBySubject, attemptsBySubject, documentsBySubject, avgScoreBySubject] =
      await Promise.all([
        Question.aggregate([
          {
            $group: {
              _id: "$subject",
              total: { $sum: 1 },
              active: { $sum: { $cond: ["$isActive", 1, 0] } },
            },
          },
          { $sort: { total: -1 } },
        ]),
        QuestionAttempt.aggregate([
          {
            $lookup: {
              from: "questions",
              localField: "questionId",
              foreignField: "_id",
              as: "question",
            },
          },
          { $unwind: "$question" },
          {
            $group: {
              _id: "$question.subject",
              attempts: { $sum: 1 },
              avgScore: { $avg: "$scores.total" },
            },
          },
          { $sort: { attempts: -1 } },
        ]),
        LibraryDocument.aggregate([
          { $match: { isLibraryContent: true, subject: { $exists: true } } },
          { $group: { _id: "$subject", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        QuestionAttempt.aggregate([
          {
            $lookup: { from: "questions", localField: "questionId", foreignField: "_id", as: "q" },
          },
          { $unwind: "$q" },
          {
            $group: {
              _id: { subject: "$q.subject", difficulty: "$q.difficulty" },
              avgScore: { $avg: "$scores.total" },
              count: { $sum: 1 },
            },
          },
          { $sort: { "_id.subject": 1, "_id.difficulty": 1 } },
        ]),
      ]);

    sendSuccess(
      res,
      {
        questionsBySubject,
        attemptsBySubject,
        documentsBySubject,
        avgScoreBySubjectAndDifficulty: avgScoreBySubject,
      },
      "Subject stats retrieved"
    );
  } catch (err) {
    sendError(res, "Failed to retrieve subject stats", 500, (err as Error).message);
  }
};
