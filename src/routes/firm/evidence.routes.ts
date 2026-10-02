import { Router } from "express";
import * as evidenceCtrl from "../../controllers/firm/firm.evidence.controller";

/**
 * LE-032 — Evidence and document requests.
 *
 * Every route here is authenticated: mount this router *below*
 * `router.use(authenticateFirm)` in src/routes/firm/index.ts. The controllers
 * take the firm from the verified token, so an unauthenticated mount would
 * throw rather than leak.
 */
const router = Router();

router.get("/", evidenceCtrl.getEvidence);

// The checklist sits above "/requests" so it is not swallowed by a later
// parameterised request route.
router.get("/requests/checklist", evidenceCtrl.getRequestChecklist);
router.post("/requests", evidenceCtrl.createRequest);
router.post("/requests/:id/items/:itemId/received", evidenceCtrl.markItemReceived);
router.post("/requests/:id/items/:itemId/remind", evidenceCtrl.remindItem);

router.post("/attach", evidenceCtrl.attachEvidence);

// Nothing moves on /sort — it only proposes. /sort/apply files what the
// reviewer accepted.
router.post("/sort", evidenceCtrl.startSorting);
router.post("/sort/apply", evidenceCtrl.applySorting);

// A recorded act: the controller refuses without a reason and writes an audit row.
router.post("/move", evidenceCtrl.moveEvidence);

export default router;
