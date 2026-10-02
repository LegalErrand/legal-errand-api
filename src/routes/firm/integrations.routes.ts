import { Router } from "express";
import * as integrationsCtrl from "../../controllers/firm/firm.integrations.controller";

/**
 * LE-044 — integrations. Authenticated: mount this BELOW
 * `router.use(authenticateFirm)` in routes/firm/index.ts. The controller also
 * gates firm-wide changes on the caller's role.
 */
const router = Router();

router.get("/settings/integrations", integrationsCtrl.getIntegrations);
// Declared before "/:providerId" paths so "default-video" is not read as a provider id.
router.put("/settings/integrations/default-video", integrationsCtrl.setDefaultVideoProvider);
router.post("/settings/integrations/:providerId/connect", integrationsCtrl.connectIntegration);
router.put(
  "/settings/integrations/:providerId/settings",
  integrationsCtrl.updateIntegrationSettings
);
router.post("/settings/integrations/:providerId/test", integrationsCtrl.testIntegration);
router.delete("/settings/integrations/:providerId", integrationsCtrl.disconnectIntegration);

export default router;
