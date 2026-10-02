import { Router } from "express";
import * as intakeCtrl from "../../controllers/firm/firm.intake.controller";

/**
 * LE-017 — the intake form editor. Authenticated: mount this BELOW
 * `router.use(authenticateFirm)` in routes/firm/index.ts.
 */
const router = Router();

router.get("/settings/intake-form", intakeCtrl.getIntakeForm);
router.put("/settings/intake-form", intakeCtrl.saveIntakeForm);
router.post("/settings/intake-form/publish", intakeCtrl.publishIntakeForm);

export default router;
