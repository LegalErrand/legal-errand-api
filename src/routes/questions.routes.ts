import { Router } from "express";
import {
  getQuestions,
  getQuestion,
  submitAnswer,
  getMyAttempts,
} from "../controllers/questions.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/", getQuestions);
router.get("/my-attempts", getMyAttempts);
router.get("/:id", getQuestion);
router.post("/:id/submit", submitAnswer);

export default router;
