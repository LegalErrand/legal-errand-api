import { Router } from "express";
import adminAuthRoutes from "./auth.routes";
import superAdminRoutes from "./superAdmin.routes";
import analyticsRoutes from "./analytics.routes";
import questionsRoutes from "./questions.routes";
import libraryRoutes from "./library.routes";
import waitlistRoutes from "./waitlist.routes";
import supportRoutes from "./support.routes";
import scraperRoutes from "./scraper.routes";

const router = Router();

router.use("/auth", adminAuthRoutes);
router.use("/super", superAdminRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/questions", questionsRoutes);
router.use("/library", libraryRoutes);
router.use("/waitlist", waitlistRoutes);
router.use("/support", supportRoutes);
router.use("/scraper", scraperRoutes);

export default router;
