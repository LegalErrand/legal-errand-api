import { Router } from "express";
import { getOverview, getUserGrowth, getUsageStats, getSubjectStats } from "../../controllers/admin/analytics.controller";
import { authenticateAdmin } from "../../middleware/adminAuth.middleware";

const router = Router();

router.use(authenticateAdmin); // all admin roles can view analytics

router.get("/overview", getOverview);
router.get("/users", getUserGrowth);
router.get("/usage", getUsageStats);
router.get("/subjects", getSubjectStats);

export default router;
