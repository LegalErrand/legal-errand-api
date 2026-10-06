import { Router } from "express";
import * as placementCtrl from "../../controllers/firm/firm.placement.controller";

/**
 * LE-046 — My placement (interns).
 *
 * MOUNTING: every route here is authenticated. Mount this router *below*
 * `router.use(authenticateFirm)` in src/routes/firm/index.ts. The controllers
 * take the firm, the member and the role from the verified token, so an
 * unauthenticated mount throws rather than leaking.
 *
 * There is deliberately no route that names an intern, a placement or a logbook
 * by id: a placement and its logbook are always the caller's own.
 */
const router = Router();

router.get("/", placementCtrl.getPlacement);
router.get("/limits", placementCtrl.getPlacementLimits);

// Logbook. "/logbook/countersign" sits above the parameterised routes so it is
// not swallowed by "/logbook/:id".
router.post("/logbook", placementCtrl.createLogbookEntry);
router.post("/logbook/countersign", placementCtrl.requestCountersign);
router.patch("/logbook/:id", placementCtrl.updateLogbookEntry);
router.delete("/logbook/:id", placementCtrl.deleteLogbookEntry);

router.patch("/goals/:id", placementCtrl.updateLearningGoal);

router.post("/sittings/:eventId/attend", placementCtrl.attendSitting);

router.patch("/assignments/:taskId", placementCtrl.updateAssignmentStep);

// The only outbound route an intern has. The recipient is the supervisor on
// their own placement — it is not a parameter.
router.post("/supervisor-message", placementCtrl.messageSupervisor);

export default router;
