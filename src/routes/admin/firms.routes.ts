import { Router } from "express";
import {
  listFirms,
  getFirm,
  getFirmMetrics,
  getFirmPeople,
  getPlans,
} from "../../controllers/admin/firms.controller";
import {
  changePlan,
  changeStatus,
  extendTrial,
  retryPayment,
  requestAccess,
  listNotes,
  addNote,
  resolveTicket,
} from "../../controllers/admin/firmActions.controller";
import { getFirmInvoices, getRevenue } from "../../controllers/admin/firmBilling.controller";
import {
  getFirmActivity,
  getAllActivity,
  getFirmUsage,
  getPlatformUsage,
  getGeography,
  getAllPeople,
  listTickets,
  getAuditLog,
  getSystemHealth,
} from "../../controllers/admin/firmInsights.controller";
import {
  authenticateAdmin,
  requireFirmAdminRead,
  requireFirmAdmin,
} from "../../middleware/adminAuth.middleware";

const router = Router();

router.use(authenticateAdmin);
// Everything here is about a paying customer's money, so it is not open to every
// admin role. Reading is the bar below; changing a firm adds requireFirmAdmin
// per route, so support can answer a ticket without being able to move a plan.
router.use(requireFirmAdminRead);

// ─── Across every firm ────────────────────────────────────────────────────────
// All of these sit above /:id, or Express reads "metrics" as a firm id.

router.get("/plans", getPlans);
router.get("/metrics", getFirmMetrics);
router.get("/revenue", getRevenue);
router.get("/usage", getPlatformUsage);
router.get("/geography", getGeography);
router.get("/people", getAllPeople);
router.get("/activity", getAllActivity);
router.get("/audit", getAuditLog);
router.get("/system", getSystemHealth);
router.get("/tickets", listTickets);
router.patch("/tickets/:ticketId", requireFirmAdmin, resolveTicket);

// ─── The list, and one firm ───────────────────────────────────────────────────

router.get("/", listFirms);
router.get("/:id", getFirm);
router.get("/:id/people", getFirmPeople);
router.get("/:id/activity", getFirmActivity);
router.get("/:id/usage", getFirmUsage);
router.get("/:id/invoices", getFirmInvoices);
router.get("/:id/notes", listNotes);

// ─── Changing a firm ──────────────────────────────────────────────────────────
// Every one of these writes an audit row. Support may read the dashboard but
// not reach any of them.

router.post("/:id/notes", requireFirmAdmin, addNote);
router.patch("/:id/plan", requireFirmAdmin, changePlan);
router.patch("/:id/status", requireFirmAdmin, changeStatus);
router.post("/:id/trial/extend", requireFirmAdmin, extendTrial);
router.post("/:id/payment/retry", requireFirmAdmin, retryPayment);
router.post("/:id/access-request", requireFirmAdmin, requestAccess);

export default router;
