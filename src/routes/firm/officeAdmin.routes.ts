import { Router } from "express";
import * as officeAdminCtrl from "../../controllers/firm/firm.officeAdmin.controller";

/**
 * LE-011 — Firm admin (office manager) dashboard.
 *
 * Mount this *below* `router.use(authenticateFirm)` in src/routes/firm/index.ts.
 * Every handler takes the firm from the verified token and re-checks the admin
 * role itself, so an unauthenticated mount throws rather than leaks — but the
 * role check belonging to the controller is not a reason to mount it loosely.
 *
 * No route here can return matter content: there is no documents, notes,
 * messages or AI-activity endpoint, and the handlers that read the calendar and
 * the invoices project matter content out. See the controller's header.
 */
const router = Router();

// ─── Tabs ────────────────────────────────────────────────────────────────────
router.get("/overview", officeAdminCtrl.getOverview);
router.get("/finance", officeAdminCtrl.getFinance);
router.get("/hr", officeAdminCtrl.getHr);
router.get("/operations", officeAdminCtrl.getOperations);
router.get("/technology", officeAdminCtrl.getTechnology);
router.get("/strategy", officeAdminCtrl.getStrategy);

// ─── Accounts ────────────────────────────────────────────────────────────────
// Above /registers/:kind so "accounts" is never read as a register name.
router.post("/accounts", officeAdminCtrl.upsertAccount);
router.patch("/accounts/:id", officeAdminCtrl.updateAccount);
router.delete("/accounts/:id", officeAdminCtrl.deleteAccount);

// ─── Registers: add, edit, mark done, delete — for every kind ────────────────
router.get("/registers/:kind", officeAdminCtrl.listRegister);
router.post("/registers/:kind", officeAdminCtrl.createRegisterEntry);
router.patch("/registers/:kind/:id", officeAdminCtrl.updateRegisterEntry);
router.post("/registers/:kind/:id/complete", officeAdminCtrl.completeRegisterEntry);
router.delete("/registers/:kind/:id", officeAdminCtrl.deleteRegisterEntry);

export default router;
