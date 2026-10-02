import { Router } from "express";
import * as intakeCtrl from "../../controllers/firm/firm.intake.controller";
import { authIpRateLimit } from "../../middleware/rateLimit.middleware";

/**
 * LE-016 — the public intake form. A prospective client has no account, so
 * these routes are NOT authenticated: mount this ABOVE
 * `router.use(authenticateFirm)` in routes/firm/index.ts.
 *
 * Every route is world-reachable, so every route is IP rate limited.
 */
const router = Router();

router.get("/public/intake/:firmSlug/form", authIpRateLimit, intakeCtrl.getPublicIntakeForm);
router.post("/public/intake/:firmSlug", authIpRateLimit, intakeCtrl.submitPublicIntake);
router.post("/public/intake/:firmSlug/save", authIpRateLimit, intakeCtrl.savePublicIntake);
router.get(
  "/public/intake/:firmSlug/resume/:resumeToken",
  authIpRateLimit,
  intakeCtrl.resumePublicIntake
);

export default router;
