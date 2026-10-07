import { Router } from "express";
import * as signCtrl from "../../controllers/firm/firm.sign.controller";
import { authenticateSigner } from "../../middleware/signingAuth.middleware";

/**
 * LE-028 — the signer's side of a signing link.
 *
 * PUBLIC: mount this ABOVE `router.use(authenticateFirm)` in
 * src/routes/firm/index.ts. A signer holds no account, so these routes are
 * reached with the link's own token and nothing else. `authenticateSigner`
 * re-checks the live request row on every call, so a spent link stops working
 * at once.
 */
const router = Router();

router.get("/sign/:token", authenticateSigner, signCtrl.getSigningPacket);
router.post("/sign/:token", authenticateSigner, signCtrl.submitSignature);
router.post("/sign/:token/decline", authenticateSigner, signCtrl.declineSignature);

export default router;
