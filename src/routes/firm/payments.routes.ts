import { Router } from "express";
import * as paymentsCtrl from "../../controllers/firm/firm.payments.controller";

/**
 * Payment gateway setup. Authenticated: mount this BELOW the firm auth
 * middleware, alongside the other settings routes.
 *
 * Setup only — nothing here takes a payment.
 */
const router = Router();

router.get("/settings/payments", paymentsCtrl.getPaymentProviders);
router.put("/settings/payments/:provider", paymentsCtrl.upsertPaymentProvider);
router.delete("/settings/payments/:provider", paymentsCtrl.deletePaymentProvider);

export default router;
