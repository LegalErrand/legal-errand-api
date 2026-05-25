import { Router } from "express";
import {
  getQuestions,
  getQuestion,
  getRandomQuestion,
  submitAnswer,
  getMyAttempts,
  getQuestionAttempts,
  getStats,
} from "../controllers/questions.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/random", getRandomQuestion); // Random question (Today's Challenge)
router.get("/stats", getStats); // Aggregate user stats
router.get("/my-attempts", getMyAttempts); // All user attempts
router.get("/", getQuestions); // List questions (filterable)
router.get("/:id", getQuestion); // Single question
router.get("/:id/attempts", getQuestionAttempts); // Attempts for a specific question
router.post("/:id/submit", submitAnswer); // Submit answer for grading

export default router;
