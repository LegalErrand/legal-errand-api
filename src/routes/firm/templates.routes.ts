import { Router } from "express";
import * as tplCtrl from "../../controllers/firm/firm.templates.controller";
import * as signCtrl from "../../controllers/firm/firm.sign.controller";

/**
 * LE-029 (templates) and LE-028 (signatures).
 *
 * Every route here is authenticated: mount this router *below*
 * `router.use(authenticateFirm)` in src/routes/firm/index.ts. The signature
 * routes in particular depend on the token for the caller's own identity —
 * `GET /signatures` filters on firmId *and* the caller's memberId, and there is
 * no parameter anywhere that names another member.
 */
const router = Router();

// ─── Templates (LE-029) ──────────────────────────────────────────────────────
router.get("/templates", tplCtrl.listFirmTemplates);
router.post("/templates/upload", tplCtrl.uploadTemplates);
// "/templates/open" sits above "/templates/:id" so it is not read as an id.
router.post("/templates/open", tplCtrl.openTemplate);
router.patch("/templates/:id/group", tplCtrl.setTemplateGroup);
router.delete("/templates/:id", tplCtrl.deleteTemplate);

// ─── Signatures (LE-028) ─────────────────────────────────────────────────────
router.get("/signatures", tplCtrl.listMySignatures);
router.post("/signatures", tplCtrl.saveSignature);
router.post("/signatures/apply", tplCtrl.applySignature);
router.post("/signatures/request", tplCtrl.requestSignature);
router.get("/signatures/requests/:id/certificate", signCtrl.getSignatureCertificate);
router.delete("/signatures/:id", tplCtrl.deleteSignature);

export default router;
