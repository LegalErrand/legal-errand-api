import { Router } from "express";
import {
  getUserProfile,
  getUserActivity,
  getUserNotes,
  getUserAttempts,
  getUserResearch,
} from "../../controllers/admin/support.controller";
import { authenticateAdmin } from "../../middleware/adminAuth.middleware";

const router = Router();

router.use(authenticateAdmin); // all admin roles can use support views

router.get("/users/:id", getUserProfile);
router.get("/users/:id/activity", getUserActivity);
router.get("/users/:id/notes", getUserNotes);
router.get("/users/:id/attempts", getUserAttempts);
router.get("/users/:id/research", getUserResearch);

export default router;
