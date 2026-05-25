import { Router } from "express";
import {
  listWaitlist,
  getWaitlistStats,
  getWaitlistEntry,
  deleteWaitlistEntry,
} from "../../controllers/admin/waitlist.controller";
import { authenticateAdmin } from "../../middleware/adminAuth.middleware";

const router = Router();

router.use(authenticateAdmin);

router.get("/", listWaitlist);
router.get("/stats", getWaitlistStats);
router.get("/:id", getWaitlistEntry);
router.delete("/:id", deleteWaitlistEntry);

export default router;
