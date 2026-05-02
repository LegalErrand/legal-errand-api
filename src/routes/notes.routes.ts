import { Router } from "express";
import {
  getNotes,
  createNote,
  updateNote,
  deleteNote,
  analyzeNote,
  getFolders,
} from "../controllers/notes.controller";
import { authenticate } from "../middleware/auth.middleware";
import { aiQueryRateLimit } from "../middleware/rateLimit.middleware";

const router = Router();

router.use(authenticate);

router.get("/", getNotes);
router.get("/folders", getFolders);
router.post("/", createNote);
router.put("/:id", updateNote);
router.delete("/:id", deleteNote);
router.post("/:id/analyze", aiQueryRateLimit, analyzeNote);   // AI note quality analysis

export default router;
