import { Router } from "express";
import authRoutes from "./auth.routes";
import aiRoutes from "./ai.routes";
import libraryRoutes from "./library.routes";
import notesRoutes from "./notes.routes";
import questionsRoutes from "./questions.routes";
import dashboardRoutes from "./dashboard.routes";
import researchRoutes from "./research.routes";
import waitlistRoutes from "./waitlist.routes";
import userRoutes from "./user.routes";
import adminRoutes from "./admin";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({
    success: true,
    message: "LegalErrand API is running",
    timestamp: new Date().toISOString(),
  });
});

router.use("/auth", authRoutes);
router.use("/ai", aiRoutes);
router.use("/library", libraryRoutes);
router.use("/notes", notesRoutes);
router.use("/questions", questionsRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/research", researchRoutes);
router.use("/waitlist", waitlistRoutes);
router.use("/user", userRoutes);
router.use("/admin", adminRoutes);

export default router;
