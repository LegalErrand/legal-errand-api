import { Router } from "express";
import { getDashboard, getStreak } from "../controllers/dashboard.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/", getDashboard);
router.get("/streak", getStreak);

export default router;
