import { Router } from "express";
import {
  chat,
  streamChat,
  explainCase,
  startSocraticSession,
  respondSocratic,
  endSocraticSession,
  getConversations,
  deleteConversation,
  getCaseExplainerHistory,
  getCaseExplanation,
  saveCaseToNotes,
} from "../controllers/ai.controller";
import { authenticate } from "../middleware/auth.middleware";
import { aiQueryRateLimit } from "../middleware/rateLimit.middleware";

const router = Router();

router.use(authenticate);

// Standard & streaming chat (rate-limited)
router.post("/chat", aiQueryRateLimit, chat);
router.post("/chat/stream", aiQueryRateLimit, streamChat);

// Conversation history
router.get("/conversations", getConversations);
router.delete("/conversations/:sessionId", deleteConversation);

// Case explainer
router.post("/explain-case", aiQueryRateLimit, explainCase);
router.get("/case-explainer/history", getCaseExplainerHistory);
router.get("/case-explainer/:id", getCaseExplanation);
router.post("/case-explainer/:id/save-to-notes", saveCaseToNotes);

// Socratic tutor
router.post("/socratic/start", startSocraticSession);
router.post("/socratic/respond", respondSocratic);
router.post("/socratic/end", endSocraticSession);

export default router;
