import { Router } from "express";
import * as bulkMoveCtrl from "../../controllers/firm/firm.bulkMove.controller";

/**
 * LE-024 — Bulk select and move.
 *
 * Mount this *below* `router.use(authenticateFirm)` in src/routes/firm/index.ts.
 * The controller takes the firm from the verified token, so an unauthenticated
 * mount throws rather than leaking across firms.
 *
 * Both routes are recorded acts: the move refuses without a reason, and the
 * undo is a real reversing move that is logged in its own right.
 */
const router = Router();

router.post("/", bulkMoveCtrl.bulkMove);
router.post("/undo", bulkMoveCtrl.undoBulkMove);

export default router;
