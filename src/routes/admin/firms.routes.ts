import { Router } from "express";
import {
  listFirms,
  getFirm,
  getFirmMetrics,
  getFirmPeople,
  getPlans,
} from "../../controllers/admin/firms.controller";
import { authenticateAdmin, requireFirmAdminRead } from "../../middleware/adminAuth.middleware";

const router = Router();

router.use(authenticateAdmin);
// Everything here is about a paying customer's money, so it is not open to
// every admin role. Changing a firm needs requireFirmAdmin on top — see the
// routes added alongside the audit log.
router.use(requireFirmAdminRead);

router.get("/plans", getPlans);
// Before /:id, or "metrics" is read as a firm id.
router.get("/metrics", getFirmMetrics);
router.get("/", listFirms);
router.get("/:id", getFirm);
router.get("/:id/people", getFirmPeople);

export default router;
