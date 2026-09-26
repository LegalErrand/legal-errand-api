import { Router } from "express";
import * as authCtrl from "../../controllers/firm/firm.auth.controller";
import * as inviteCtrl from "../../controllers/firm/firm.invitations.controller";
import * as dashCtrl from "../../controllers/firm/firm.dashboard.controller";
import * as clientCtrl from "../../controllers/firm/firm.clients.controller";
import * as matterCtrl from "../../controllers/firm/firm.matters.controller";
import * as docCtrl from "../../controllers/firm/firm.documents.controller";
import * as taskCtrl from "../../controllers/firm/firm.tasks.controller";
import * as reviewCtrl from "../../controllers/firm/firm.review.controller";
import * as calCtrl from "../../controllers/firm/firm.calendar.controller";
import * as commCtrl from "../../controllers/firm/firm.communications.controller";
import * as billCtrl from "../../controllers/firm/firm.billing.controller";
import * as analCtrl from "../../controllers/firm/firm.analytics.controller";
import * as teamCtrl from "../../controllers/firm/firm.team.controller";
import * as settCtrl from "../../controllers/firm/firm.settings.controller";
import * as aiCtrl from "../../controllers/firm/firm.ai.controller";
import { authenticateFirm } from "../../middleware/firmAuth.middleware";
import { authIpRateLimit } from "../../middleware/rateLimit.middleware";

const router = Router();

// ─── Auth & Onboarding (public) ───────────────────────────────────────────────
// Kept for existing callers; the screens use the three-step sign-up below.
router.post("/auth/onboarding", authIpRateLimit, authCtrl.onboardFirm);

// Sign up: email + password, six-digit code, then the firm's details.
router.post("/auth/signup", authIpRateLimit, authCtrl.startFirmSignup);
router.post("/auth/signup/resend", authIpRateLimit, authCtrl.resendSignupCode);
router.post("/auth/signup/verify", authIpRateLimit, authCtrl.verifySignupEmail);
router.post("/auth/signup/firm", authIpRateLimit, authCtrl.completeFirmSetup);

// Log in: password, then a one-time code. /auth/login no longer returns a
// session token on its own — /auth/login/verify does.
router.post("/auth/login", authIpRateLimit, authCtrl.loginFirmMember);
router.post("/auth/login/verify", authIpRateLimit, authCtrl.verifyLoginOtp);
router.post("/auth/login/resend", authIpRateLimit, authCtrl.resendLoginOtp);

// Password recovery.
router.post("/auth/forgot-password", authIpRateLimit, authCtrl.requestPasswordReset);
router.post("/auth/reset-password", authIpRateLimit, authCtrl.resetPassword);

// Invitations: looking one up and accepting it are public — the person
// holding the link has no account yet.
router.get("/invitations/:token", authIpRateLimit, inviteCtrl.getInvitation);
router.post("/invitations/:token/accept", authIpRateLimit, inviteCtrl.acceptInvitation);

// Everything below requires a valid firm token.
router.use(authenticateFirm);

router.get("/auth/me", authCtrl.getCurrentMember);

router.post("/invitations", inviteCtrl.sendInvitations);

// ─── Dashboard ────────────────────────────────────────────────────────────────
router.get("/dashboard", dashCtrl.getDashboardSummary);

// ─── Clients & Intake ─────────────────────────────────────────────────────────
router.get("/clients", clientCtrl.getClients);
router.post("/clients", clientCtrl.createClient);
router.get("/clients/intake/:id", clientCtrl.getClientIntake);
router.post("/clients/intake/:id/accept", clientCtrl.acceptClientIntake);
router.get("/clients/:id", clientCtrl.getClientById);

// ─── Matters ─────────────────────────────────────────────────────────────────
router.get("/matters", matterCtrl.getMatters);
router.post("/matters", matterCtrl.createMatter);
router.get("/matters/:id", matterCtrl.getMatterById);
router.post("/matters/:id/assign", matterCtrl.assignWorkToJunior);

// ─── Documents ───────────────────────────────────────────────────────────────
router.get("/documents", docCtrl.getDocuments);
router.post("/documents/generate", docCtrl.generateDocumentDraft);
router.get("/documents/:id/review", docCtrl.reviewAndChat);
router.post("/documents/:id/chat", docCtrl.reviewAndChat);

// ─── Tasks ───────────────────────────────────────────────────────────────────
router.get("/tasks", taskCtrl.getTasks);
router.post("/tasks", taskCtrl.createTask);
router.patch("/tasks/:id/status", taskCtrl.updateTaskStatus);

// ─── Review Queue ────────────────────────────────────────────────────────────
router.get("/reviews", reviewCtrl.getReviewQueue);
router.get("/reviews/:id", reviewCtrl.getReviewItemById);
router.post("/reviews/:id/action", reviewCtrl.actionReviewItem);

// ─── Calendar ────────────────────────────────────────────────────────────────
router.get("/calendar", calCtrl.getCalendarEvents);
router.post("/calendar", calCtrl.createCalendarEvent);
router.post("/calendar/:id/prep", calCtrl.startHearingPrep);

// ─── Communications ──────────────────────────────────────────────────────────
router.get("/communications", commCtrl.getMessages);
router.post("/communications/send", commCtrl.sendMessage);

// ─── Time & Billing ──────────────────────────────────────────────────────────
router.get("/billing/entries", billCtrl.getTimeEntries);
router.patch("/billing/entries/:id/approve", billCtrl.approveTimeEntry);
router.post("/billing/invoices", billCtrl.generateInvoice);

// ─── Analytics ───────────────────────────────────────────────────────────────
router.get("/analytics", analCtrl.getAnalytics);

// ─── Team & Supervision ──────────────────────────────────────────────────────
router.get("/team", teamCtrl.getTeamSupervision);
router.post("/team/cover", teamCtrl.activateHandoverCover);

// ─── AI Assistant ────────────────────────────────────────────────────────────
router.post("/ai/chat", aiCtrl.askAssistant);

// ─── Settings & Escalation ───────────────────────────────────────────────────
router.get("/settings", settCtrl.getFirmSettings);
router.patch("/settings/autonomy", settCtrl.updateAIAutonomy);
router.get("/settings/escalation", settCtrl.getEscalationRules);

export default router;
