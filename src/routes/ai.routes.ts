import { Router } from "express";
import {
  chat,
  streamChat,
  explainCase,
  startSocraticSession,
  respondSocratic,
  endSocraticSession,
} from "../controllers/ai.controller";
import { authenticate } from "../middleware/auth.middleware";
import { aiQueryRateLimit } from "../middleware/rateLimit.middleware";

const router = Router();

router.use(authenticate);

// Standard chat (rate-limited for free tier)
router.post("/chat", aiQueryRateLimit, chat);
router.post("/chat/stream", aiQueryRateLimit, streamChat);

// Case explainer (rate-limited)
router.post("/explain-case", aiQueryRateLimit, explainCase);

// Socratic tutor
router.post("/socratic/start", startSocraticSession);
router.post("/socratic/respond", respondSocratic);
router.post("/socratic/end", endSocraticSession);

export default router;
