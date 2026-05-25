import { Router } from "express";
import {
  getNotes,
  getNote,
  createNote,
  updateNote,
  deleteNote,
  analyzeNote,
  summarizeNote,
  expandNote,
  getRelatedNotes,
  getTemplates,
  getFolders,
} from "../controllers/notes.controller";
import { authenticate } from "../middleware/auth.middleware";
import { aiQueryRateLimit } from "../middleware/rateLimit.middleware";

const router = Router();

router.use(authenticate);

router.get("/templates", getTemplates); // List note templates
router.get("/folders", getFolders); // List user's folders
router.get("/", getNotes); // List notes (filterable)
router.post("/", createNote); // Create note
router.get("/:id", getNote); // Get single note
router.put("/:id", updateNote); // Update note
router.delete("/:id", deleteNote); // Delete note
router.post("/:id/analyze", aiQueryRateLimit, analyzeNote); // AI quality analysis
router.post("/:id/summarize", aiQueryRateLimit, summarizeNote); // AI summarize
router.post("/:id/expand", aiQueryRateLimit, expandNote); // AI expand
router.get("/:id/related", getRelatedNotes); // Related notes

export default router;
