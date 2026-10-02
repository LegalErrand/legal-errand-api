import { Router } from "express";
import * as portalCtrl from "../../controllers/firm/firm.portal.controller";
import { authenticatePortalClient } from "../../middleware/portalAuth.middleware";
import { authenticateFirm } from "../../middleware/firmAuth.middleware";

/**
 * The client portal (LE-035, LE-036).
 *
 * MOUNTING: this router must be mounted ABOVE `router.use(authenticateFirm)` in
 * routes/firm/index.ts. Its own `authenticatePortalClient` is the only auth that
 * may open these routes; a firm session token carries `scope: "firm"` and is
 * refused here on purpose. Mounting it below the firm gate would require a firm
 * token first and would break every client link.
 */
const router = Router();

router.use(authenticatePortalClient);

router.get("/overview", portalCtrl.getPortalOverview);
router.get("/documents", portalCtrl.getPortalDocuments);
router.get("/invoices", portalCtrl.getPortalInvoices);

router.get("/messages", portalCtrl.getPortalMessages);
router.post("/messages", portalCtrl.sendPortalMessage);
router.post("/raise-with-partner", portalCtrl.raiseWithPartner);

router.get("/calendar", portalCtrl.getPortalCalendar);
router.get("/booking/slots", portalCtrl.getBookingSlots);
router.post("/booking", portalCtrl.createBooking);

router.post("/ask", portalCtrl.askPortalAi);
router.get("/glossary", portalCtrl.getGlossary);

/**
 * The one firm-authenticated route in this feature: the firm minting a client's
 * link. It applies `authenticateFirm` itself, so it is safe to mount above the
 * shared firm gate alongside the portal router.
 */
export const portalLinkRouter = Router();

portalLinkRouter.use(authenticateFirm);
portalLinkRouter.post("/clients/:id/portal-link", portalCtrl.createClientPortalLink);

export default router;
