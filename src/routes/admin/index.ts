import { Router } from "express";
import adminAuthRoutes from "./auth.routes";
import superAdminRoutes from "./superAdmin.routes";
import analyticsRoutes from "./analytics.routes";
import questionsRoutes from "./questions.routes";
import libraryRoutes from "./library.routes";
import waitlistRoutes from "./waitlist.routes";
import supportRoutes from "./support.routes";

const router = Router();

router.use("/auth", adminAuthRoutes);
router.use("/super", superAdminRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/questions", questionsRoutes);
router.use("/library", libraryRoutes);
router.use("/waitlist", waitlistRoutes);
router.use("/support", supportRoutes);

export default router;
