import { Router } from "express";
import {
  search,
  generateMemo,
  getSessions,
  getSession,
  saveResultToNotes,
  deleteSession,
} from "../controllers/research.controller";
import { authenticate } from "../middleware/auth.middleware";
import { researchRateLimit } from "../middleware/rateLimit.middleware";

const router = Router();

router.use(authenticate);

router.post("/search", researchRateLimit, search); // Search legal corpus
router.get("/sessions", getSessions); // List past sessions
router.get("/sessions/:id", getSession); // Single session
router.post("/sessions/:sessionId/memo", generateMemo); // Generate research memo
router.post("/sessions/:id/save-to-notes", saveResultToNotes); // Save result to notes
router.delete("/sessions/:id", deleteSession); // Delete session

export default router;
