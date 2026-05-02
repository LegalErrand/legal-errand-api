import { Router } from "express";
import { search, generateMemo, getSessions, getSession } from "../controllers/research.controller";
import { authenticate } from "../middleware/auth.middleware";
import { researchRateLimit } from "../middleware/rateLimit.middleware";

const router = Router();

router.use(authenticate);

router.post("/search", researchRateLimit, search);
router.get("/sessions", getSessions);
router.get("/sessions/:id", getSession);
router.post("/sessions/:sessionId/memo", generateMemo);

export default router;
