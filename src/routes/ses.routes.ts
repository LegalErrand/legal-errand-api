import express, { Router } from "express";
import { handleSesNotification } from "../controllers/ses.webhook.controller";

/**
 * SES bounce and complaint notifications (via SNS).
 *
 * PUBLIC and unauthenticated: SNS has no credentials to present. The controller
 * verifies the AWS signature before acting, which is what actually guards this.
 *
 * SNS posts its JSON with Content-Type `text/plain`, so the app-wide
 * express.json() leaves req.body untouched. A text parser is mounted here, on
 * this path only, rather than widening the global parser for one endpoint.
 */
const router = Router();

router.post("/notifications", express.text({ type: "*/*", limit: "512kb" }), handleSesNotification);

export default router;
