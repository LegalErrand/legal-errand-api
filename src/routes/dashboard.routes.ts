import { Router } from "express";
import {
  getDashboard,
  getStreak,
  getActivity,
  getAchievements,
  getGoals,
  createGoal,
  updateGoal,
  deleteGoal,
  getInsights,
  getReasoningScore,
} from "../controllers/dashboard.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/", getDashboard);                    // Full dashboard data
router.get("/streak", getStreak);                 // Streak calendar
router.get("/activity", getActivity);             // Paginated activity history
router.get("/achievements", getAchievements);     // Badges & achievements
router.get("/insights", getInsights);             // AI-generated study insights
router.get("/reasoning-score", getReasoningScore); // Legal Reasoning Score

// Study goals
router.get("/goals", getGoals);
router.post("/goals", createGoal);
router.put("/goals/:id", updateGoal);
router.delete("/goals/:id", deleteGoal);

export default router;
