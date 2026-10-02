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
import * as todoCtrl from "../../controllers/firm/firm.todos.controller";
import * as ssoCtrl from "../../controllers/firm/firm.sso.controller";
import intakePublicRoutes from "./intake-public.routes";
import intakeRoutes from "./intake.routes";
import integrationsRoutes from "./integrations.routes";
import evidenceRoutes from "./evidence.routes";
import templatesRoutes from "./templates.routes";
import portalRouter, { portalLinkRouter } from "./portal.routes";
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

// Single sign-on (LE-001 req. 11). Public: the person has no session yet.
// SSO issues a session directly — no emailed code — because the identity
// provider has already applied its own second factor and no password of ours
// is involved.
router.get("/auth/sso/policy", authIpRateLimit, ssoCtrl.getSsoPolicy);
router.post("/auth/sso", authIpRateLimit, ssoCtrl.signInWithSso);

// Password recovery.
router.post("/auth/forgot-password", authIpRateLimit, authCtrl.requestPasswordReset);
router.post("/auth/reset-password", authIpRateLimit, authCtrl.resetPassword);

// Passwordless sign-in. Holding the emailed link proves the inbox, which is
// what the one-time code proves, so it stands in for the password and the code.
router.post("/auth/magic-link", authIpRateLimit, authCtrl.requestMagicLink);
router.post("/auth/magic-link/verify", authIpRateLimit, authCtrl.verifyMagicLink);

// Invitations: looking one up and accepting it are public — the person
// holding the link has no account yet.
router.get("/invitations/:token", authIpRateLimit, inviteCtrl.getInvitation);
router.post("/invitations/:token/accept", authIpRateLimit, inviteCtrl.acceptInvitation);

// The public intake form (LE-016). A prospective client has no account, so
// these must sit above the firm gate. They are IP rate limited inside.
router.use(intakePublicRoutes);

// Client portal (LE-035/036). It carries its own portal-scope auth — a firm
// token must never open these, and a portal token must never open firm routes.
router.use("/portal", portalRouter);
// Firm-authenticated, but applies authenticateFirm itself so it can sit here.
router.use(portalLinkRouter);

// Everything below requires a valid firm token.
router.use(authenticateFirm);

router.get("/auth/me", authCtrl.getCurrentMember);

router.post("/invitations", inviteCtrl.sendInvitations);

// Bar verification gates what leaves the firm with a lawyer's name on it,
// not whether they can sign in, so it needs a real session rather than one of
// the sign-up tokens.
router.get("/auth/bar", authCtrl.getBarVerification);
router.post("/auth/bar", authCtrl.submitBarVerification);

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

// ─── To-dos (LE-021) ─────────────────────────────────────────────────────────
// Private to the person who owns them; the controller scopes every query to
// both the firm and the caller, so there is no route that reads another
// member's list.
router.get("/todos", todoCtrl.getTodos);
router.post("/todos", todoCtrl.createTodo);
router.patch("/todos/:id", todoCtrl.updateTodo);
router.delete("/todos/:id", todoCtrl.deleteTodo);
router.post("/todos/:id/complete", todoCtrl.completeTodo);
router.post("/todos/:id/delegate", todoCtrl.delegateTodo);

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
router.patch("/settings/sso", settCtrl.updateSsoPolicy);
router.get("/settings/escalation", settCtrl.getEscalationRules);

// ─── Intake form, integrations, evidence, templates and signatures ───────────
router.use(intakeRoutes);
router.use(integrationsRoutes);
router.use("/evidence", evidenceRoutes);
router.use("/", templatesRoutes);

export default router;
