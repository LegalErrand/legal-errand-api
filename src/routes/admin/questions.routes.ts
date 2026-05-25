import { Router } from "express";
import {
  listQuestions,
  getQuestion,
  createQuestion,
  updateQuestion,
  toggleQuestion,
  deleteQuestion,
  bulkImportQuestions,
} from "../../controllers/admin/questions.controller";
import { authenticateAdmin, requireContentAdmin } from "../../middleware/adminAuth.middleware";

const router = Router();

router.use(authenticateAdmin, requireContentAdmin);

router.get("/", listQuestions);
router.post("/", createQuestion);
router.post("/bulk", bulkImportQuestions);
router.get("/:id", getQuestion);
router.patch("/:id", updateQuestion);
router.patch("/:id/toggle", toggleQuestion);
router.delete("/:id", deleteQuestion);

export default router;
