import swaggerUi from "swagger-ui-express";
import { Express } from "express";
import { env } from "./env";
import { logger } from "../utils/logger";
import { userPaths } from "./swaggerPaths.user";
import { adminPaths } from "./swaggerPaths.admin";
import { swaggerComponents } from "./swaggerComponents";

const SERVERS = [
  { url: "https://api.legalerrand.com/api/v1", description: "Production" },
  { url: "https://dev-api.legalerrand.com/api/v1", description: "Development" },
  { url: `http://localhost:${env.PORT}/api/v1`, description: "Local" },
];

// ─── User Spec ────────────────────────────────────────────────────────────────

const userSpec = {
  openapi: "3.0.0",
  info: {
    title: "LegalErrand Academy — API",
    version: "1.0.0",
    description: [
      "REST API for LegalErrand Academy, an AI-native study platform for Nigerian law students.",
      "",
      "### Authentication",
      "All endpoints except those marked with no lock icon require a **Bearer JWT** in the `Authorization` header.",
      "Obtain a token from `POST /auth/login` or `POST /auth/verify-email`.",
      "",
      "### Rate Limits",
      "AI endpoints (chat, case explainer, research) are rate-limited by daily quota: **10 AI queries/day** and **5 research sessions/day** on the free tier.",
      "",
      "### Email (OTP)",
      "Verification and password-reset OTPs use **ZeptoMail SMTP** first (`ZEPTO_SMTP_*`), then **Zoho SMTP**, then **Resend**. Email failures are logged server-side and do not block API responses.",
      "",
      "### Response shape",
      "Most endpoints return `{ success, message, data?, meta? }`. Errors return `{ success: false, message }` (and optional `error` in development).",
    ].join("\n"),
  },
  servers: SERVERS,
  tags: [
    { name: "Health", description: "API status" },
    { name: "Auth", description: "Registration, login, OTP verification, password reset" },
    { name: "User", description: "Profile management, avatar, referrals" },
    {
      name: "Library",
      description: "Browse the platform library and manage personal document uploads",
    },
    { name: "Notes", description: "Create and manage study notes with AI enhancement" },
    { name: "Questions", description: "Practice questions with AI IRAC grading" },
    {
      name: "Dashboard",
      description: "Study stats, activity feed, goals, achievements, and reasoning score",
    },
    { name: "AI — Chat", description: "General AI legal assistant (standard and streaming)" },
    { name: "AI — Case Explainer", description: "Structured case breakdown with history" },
    { name: "AI — Socratic Tutor", description: "Guided Socratic questioning sessions" },
    { name: "Research", description: "AI-powered legal research across the document library" },
    { name: "Waitlist", description: "Pre-launch waitlist signup" },
  ],
  components: swaggerComponents,
  security: [{ bearerAuth: [] }],
  paths: userPaths,
};

// ─── Admin Spec ───────────────────────────────────────────────────────────────

const adminSpec = {
  openapi: "3.0.0",
  info: {
    title: "LegalErrand Academy — Admin API",
    version: "1.0.0",
    description: [
      "Internal admin API for the LegalErrand Academy platform.",
      "",
      "### Authentication",
      "All endpoints require an **admin Bearer JWT** obtained from `POST /admin/auth/login`.",
      "Admin tokens include `isAdmin: true` and the admin's `role` claim.",
      "",
      "### Role Access",
      "| Role | Access |",
      "|---|---|",
      "| `super_admin` | Full access to all sections |",
      "| `content_admin` | Analytics (read), Question Bank, Library Management |",
      "| `support_admin` | Analytics (read), Waitlist (read), Support views |",
      "",
      "### Local super admin",
      "Seed with `npx ts-node --transpile-only src/scripts/createSuperAdmin.ts` (uses `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` from `.env`).",
      "",
      "### Response shape",
      "Same as the user API: `{ success, message, data?, meta? }`.",
    ].join("\n"),
  },
  servers: SERVERS,
  tags: [
    { name: "Admin — Auth", description: "Admin login and session management" },
    {
      name: "Super Admin — Admin Management",
      description: "Create, update, block, and delete admin accounts. Requires super_admin.",
    },
    {
      name: "Super Admin — User Management",
      description: "Full user CRUD and block controls. Requires super_admin.",
    },
    {
      name: "Analytics",
      description: "Platform-wide stats: users, usage, subjects. All admin roles.",
    },
    {
      name: "Question Bank",
      description: "Manage the practice question bank. Requires content_admin or super_admin.",
    },
    {
      name: "Library Management",
      description: "Manage platform library content. Requires content_admin or super_admin.",
    },
    {
      name: "Waitlist Management",
      description: "View and manage waitlist entries. All admin roles.",
    },
    {
      name: "Support",
      description:
        "Read-only user profile and activity views for support investigations. All admin roles.",
    },
  ],
  components: swaggerComponents,
  security: [{ bearerAuth: [] }],
  paths: adminPaths,
};

// ─── Swagger UI options ───────────────────────────────────────────────────────

const uiOptions = (title: string): swaggerUi.SwaggerUiOptions => ({
  customCss: `
    .swagger-ui .topbar { background-color: #1a1a2e; }
    .swagger-ui .topbar-wrapper img { display: none; }
    .swagger-ui .topbar-wrapper::after { content: "${title}"; color: #fff; font-size: 18px; font-weight: 600; }
  `,
  customSiteTitle: title,
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    docExpansion: "none",
    filter: true,
    tagsSorter: "alpha",
  },
});

// ─── Setup ────────────────────────────────────────────────────────────────────

export const setupSwagger = (app: Express) => {
  // Each route gets its own serveFiles(spec) so the specs are fully isolated.
  // Using the shared swaggerUi.serve middleware causes the second setup() call
  // to overwrite the first, making both routes render the same (last) spec.

  app.use(
    "/docs",
    swaggerUi.serveFiles(userSpec, {}),
    swaggerUi.setup(userSpec, uiOptions("LegalErrand API Docs"))
  );
  app.get("/docs.json", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.json(userSpec);
  });

  app.use(
    "/admin-docs",
    swaggerUi.serveFiles(adminSpec, {}),
    swaggerUi.setup(adminSpec, uiOptions("LegalErrand Admin API Docs"))
  );
  app.get("/admin-docs.json", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.json(adminSpec);
  });

  logger.info(`User docs  → http://localhost:${env.PORT}/docs`);
  logger.info(`Admin docs → http://localhost:${env.PORT}/admin-docs`);
};
