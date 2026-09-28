export const adminPaths: Record<string, unknown> = {
  // ─── Admin Auth ────────────────────────────────────────────────────────────

  "/admin/auth/login": {
    post: {
      tags: ["Admin — Auth"],
      summary: "Admin login",
      description:
        "Issues an 8-hour admin JWT (`isAdmin: true`, `role` claim). Create the first super admin locally with `createSuperAdmin.ts` using `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` in `.env`.",
      security: [],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email", "password"],
              properties: {
                email: { type: "string", format: "email", example: "admin@legalerrand.com" },
                password: { type: "string", format: "password", example: "Admin@1234!" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Login successful.",
          content: {
            "application/json": {
              schema: {
                allOf: [
                  { $ref: "#/components/schemas/ApiSuccess" },
                  {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        properties: {
                          token: { type: "string" },
                          admin: { $ref: "#/components/schemas/AdminAccount" },
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
        "400": { description: "Email and password are required." },
        "401": { description: "Incorrect password / admin suspended." },
        "404": { description: "Admin not found." },
        "500": { description: "Login failed." },
      },
    },
  },

  "/admin/auth/me": {
    get: {
      tags: ["Admin — Auth"],
      summary: "Get current admin profile",
      responses: {
        "200": { description: "Returns authenticated admin object." },
        "401": { description: "Unauthorized." },
      },
    },
  },

  "/admin/auth/logout": {
    post: {
      tags: ["Admin — Auth"],
      summary: "Admin logout",
      responses: { "200": { description: "Logged out successfully." } },
    },
  },

  // ─── Super Admin — Admin Management ───────────────────────────────────────

  "/admin/super/admins": {
    post: {
      tags: ["Super Admin — Admin Management"],
      summary: "Create a new admin",
      description: "Only super_admin can create admins. Default role is support_admin.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["firstName", "lastName", "email", "password"],
              properties: {
                firstName: { type: "string" },
                lastName: { type: "string" },
                email: { type: "string", format: "email" },
                password: { type: "string", minLength: 8 },
                role: {
                  type: "string",
                  enum: ["super_admin", "content_admin", "support_admin"],
                  default: "support_admin",
                },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Admin created successfully." },
        "400": { description: "Email already exists or invalid role." },
      },
    },
    get: {
      tags: ["Super Admin — Admin Management"],
      summary: "List all admins",
      parameters: [
        {
          in: "query",
          name: "role",
          schema: { type: "string", enum: ["super_admin", "content_admin", "support_admin"] },
        },
        { in: "query", name: "isBlocked", schema: { type: "boolean" } },
        { in: "query", name: "page", schema: { type: "integer", default: 1 } },
        { in: "query", name: "limit", schema: { type: "integer", default: 20 } },
      ],
      responses: { "200": { description: "Paginated list of admin accounts." } },
    },
  },

  "/admin/super/admins/{id}": {
    get: {
      tags: ["Super Admin — Admin Management"],
      summary: "Get a single admin",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Admin object." }, "404": { description: "Not found." } },
    },
    delete: {
      tags: ["Super Admin — Admin Management"],
      summary: "Delete an admin",
      description: "Cannot delete your own account.",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Admin deleted." },
        "400": { description: "Cannot delete yourself." },
      },
    },
  },

  "/admin/super/admins/{id}/role": {
    patch: {
      tags: ["Super Admin — Admin Management"],
      summary: "Change an admin's role",
      description: "Cannot change your own role.",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["role"],
              properties: {
                role: { type: "string", enum: ["super_admin", "content_admin", "support_admin"] },
              },
            },
          },
        },
      },
      responses: { "200": { description: "Role updated." } },
    },
  },

  "/admin/super/admins/{id}/block": {
    patch: {
      tags: ["Super Admin — Admin Management"],
      summary: "Toggle admin block / unblock",
      description: "Toggles the blocked state. Cannot block yourself.",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason shown if blocking (optional)" },
              },
            },
          },
        },
      },
      responses: { "200": { description: "Admin blocked or unblocked." } },
    },
  },

  "/admin/super/admins/{id}/reset-password": {
    patch: {
      tags: ["Super Admin — Admin Management"],
      summary: "Reset an admin's password",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["newPassword"],
              properties: { newPassword: { type: "string", minLength: 8 } },
            },
          },
        },
      },
      responses: { "200": { description: "Password reset successfully." } },
    },
  },

  // ─── Super Admin — User Management ────────────────────────────────────────

  "/admin/super/users": {
    get: {
      tags: ["Super Admin — User Management"],
      summary: "List all users",
      parameters: [
        {
          in: "query",
          name: "search",
          schema: { type: "string" },
          description: "Searches firstName, lastName, email",
        },
        { in: "query", name: "isBlocked", schema: { type: "boolean" } },
        { in: "query", name: "tier", schema: { type: "string", enum: ["free", "premium"] } },
        {
          in: "query",
          name: "accountType",
          schema: { type: "string", enum: ["Undergraduate", "Law School Student"] },
        },
        { in: "query", name: "page", schema: { type: "integer", default: 1 } },
        { in: "query", name: "limit", schema: { type: "integer", default: 20 } },
      ],
      responses: { "200": { description: "Paginated list of users." } },
    },
  },

  "/admin/super/users/{id}": {
    get: {
      tags: ["Super Admin — User Management"],
      summary: "Get a single user",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "User object." }, "404": { description: "Not found." } },
    },
    patch: {
      tags: ["Super Admin — User Management"],
      summary: "Update user details",
      description:
        "Updatable fields: firstName, lastName, email, accountType, username, country, city, schoolName, levelYear, matricNumber, phoneNumber, tier, isEmailVerified.",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                firstName: { type: "string" },
                lastName: { type: "string" },
                email: { type: "string" },
                tier: { type: "string", enum: ["free", "premium"] },
                isEmailVerified: { type: "boolean" },
                accountType: { type: "string", enum: ["Undergraduate", "Law School Student"] },
              },
            },
          },
        },
      },
      responses: { "200": { description: "User updated." } },
    },
    delete: {
      tags: ["Super Admin — User Management"],
      summary: "Delete a user",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "User deleted." }, "404": { description: "Not found." } },
    },
  },

  "/admin/super/users/{id}/block": {
    patch: {
      tags: ["Super Admin — User Management"],
      summary: "Toggle user block / unblock",
      description: "Blocked users cannot log in.",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { reason: { type: "string" } },
            },
          },
        },
      },
      responses: { "200": { description: "User blocked or unblocked." } },
    },
  },

  // ─── Analytics ─────────────────────────────────────────────────────────────

  "/admin/analytics/overview": {
    get: {
      tags: ["Analytics"],
      summary: "Platform overview",
      description:
        "Key counters: total users, active users (7d/30d), new today, premium count, conversion rate, document counts, question counts, activity totals, waitlist size.",
      responses: { "200": { description: "Overview stats object." } },
    },
  },

  "/admin/analytics/users": {
    get: {
      tags: ["Analytics"],
      summary: "User growth stats",
      parameters: [
        {
          in: "query",
          name: "period",
          schema: { type: "string", enum: ["7d", "30d", "90d"], default: "30d" },
        },
      ],
      responses: {
        "200": {
          description: "Daily growth chart, breakdown by account type, tier, and top 10 countries.",
        },
      },
    },
  },

  "/admin/analytics/usage": {
    get: {
      tags: ["Analytics"],
      summary: "Platform usage stats",
      description:
        "Daily aggregated study minutes, AI queries, notes, questions answered, research sessions. Top study streaks. Average IRAC scores.",
      parameters: [
        {
          in: "query",
          name: "period",
          schema: { type: "string", enum: ["7d", "30d", "90d"], default: "30d" },
        },
      ],
      responses: { "200": { description: "Usage stats with daily breakdown and averages." } },
    },
  },

  "/admin/analytics/subjects": {
    get: {
      tags: ["Analytics"],
      summary: "Subject-level stats",
      description:
        "Questions, attempts, documents, and average scores broken down by subject and difficulty.",
      responses: { "200": { description: "Subject stats breakdown." } },
    },
  },

  // ─── Question Bank ─────────────────────────────────────────────────────────

  "/admin/questions": {
    get: {
      tags: ["Question Bank"],
      summary: "List all questions",
      parameters: [
        { in: "query", name: "subject", schema: { type: "string" } },
        {
          in: "query",
          name: "difficulty",
          schema: { type: "string", enum: ["beginner", "intermediate", "advanced"] },
        },
        {
          in: "query",
          name: "type",
          schema: { type: "string", enum: ["hypothetical", "issue_spotting", "application"] },
        },
        { in: "query", name: "isActive", schema: { type: "boolean" } },
        { in: "query", name: "search", schema: { type: "string" } },
        { in: "query", name: "page", schema: { type: "integer", default: 1 } },
        { in: "query", name: "limit", schema: { type: "integer", default: 20 } },
      ],
      responses: { "200": { description: "Paginated list of questions." } },
    },
    post: {
      tags: ["Question Bank"],
      summary: "Create a question",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["type", "subject", "difficulty", "prompt"],
              properties: {
                type: { type: "string", enum: ["hypothetical", "issue_spotting", "application"] },
                subject: { type: "string", example: "Tort Law" },
                difficulty: { type: "string", enum: ["beginner", "intermediate", "advanced"] },
                prompt: { type: "string" },
                modelAnswer: { type: "string" },
                gradingNotes: { type: "string", description: "Internal grading hints for the AI" },
                tags: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
      responses: { "201": { description: "Question created." } },
    },
  },

  "/admin/questions/bulk": {
    post: {
      tags: ["Question Bank"],
      summary: "Bulk import questions (max 100)",
      description: "Validates all entries first, then inserts in a single database round trip.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["questions"],
              properties: {
                questions: {
                  type: "array",
                  maxItems: 100,
                  items: {
                    type: "object",
                    required: ["type", "subject", "difficulty", "prompt"],
                    properties: {
                      type: { type: "string" },
                      subject: { type: "string" },
                      difficulty: { type: "string" },
                      prompt: { type: "string" },
                      modelAnswer: { type: "string" },
                      gradingNotes: { type: "string" },
                      tags: { type: "array", items: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      responses: { "201": { description: "Returns count and created questions[]." } },
    },
  },

  "/admin/questions/{id}": {
    get: {
      tags: ["Question Bank"],
      summary: "Get a question",
      description: "Returns the question plus live stats: attempt count and average score.",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Question with stats." } },
    },
    patch: {
      tags: ["Question Bank"],
      summary: "Update a question",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                type: { type: "string" },
                subject: { type: "string" },
                difficulty: { type: "string" },
                prompt: { type: "string" },
                modelAnswer: { type: "string" },
                gradingNotes: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
                isActive: { type: "boolean" },
              },
            },
          },
        },
      },
      responses: { "200": { description: "Question updated." } },
    },
    delete: {
      tags: ["Question Bank"],
      summary: "Delete a question",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Question deleted." } },
    },
  },

  "/admin/questions/{id}/toggle": {
    patch: {
      tags: ["Question Bank"],
      summary: "Activate / deactivate a question",
      description: "Deactivated questions are hidden from users but preserved in the database.",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Question toggled. Returns updated isActive state." } },
    },
  },

  // ─── Library Management ────────────────────────────────────────────────────

  "/admin/library": {
    get: {
      tags: ["Library Management"],
      summary: "List all documents (platform + user uploads)",
      parameters: [
        { in: "query", name: "subject", schema: { type: "string" } },
        { in: "query", name: "type", schema: { type: "string" } },
        {
          in: "query",
          name: "isLibraryContent",
          schema: { type: "boolean" },
          description: "true = platform library, false = user uploads",
        },
        {
          in: "query",
          name: "uploadedBy",
          schema: { type: "string" },
          description: "Filter by user ID",
        },
        { in: "query", name: "search", schema: { type: "string" } },
        { in: "query", name: "page", schema: { type: "integer", default: 1 } },
        { in: "query", name: "limit", schema: { type: "integer", default: 20 } },
      ],
      responses: { "200": { description: "Paginated documents with uploadedBy populated." } },
    },
  },

  "/admin/library/upload-url": {
    post: {
      tags: ["Library Management"],
      summary: "Get presigned URL for platform content upload",
      description:
        "Uploads to the LIBRARY S3 folder. Follow up with /admin/library/upload/complete.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["fileName", "mimeType"],
              properties: {
                fileName: { type: "string" },
                mimeType: { type: "string" },
              },
            },
          },
        },
      },
      responses: { "200": { description: "Returns uploadUrl, s3Key, s3Url, expiresIn (300s)." } },
    },
  },

  "/admin/library/upload/complete": {
    post: {
      tags: ["Library Management"],
      summary: "Save platform library document",
      description: "Creates a document record with isLibraryContent: true.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["title", "type", "s3Key", "s3Url", "fileSize"],
              properties: {
                title: { type: "string" },
                type: {
                  type: "string",
                  enum: ["case_law", "statute", "textbook", "study_guide", "exam_paper"],
                },
                subject: { type: "string" },
                s3Key: { type: "string" },
                s3Url: { type: "string" },
                fileSize: { type: "number" },
                metadata: {
                  type: "object",
                  properties: {
                    court: { type: "string" },
                    year: { type: "integer" },
                    citation: { type: "string" },
                    jurisdiction: { type: "string", default: "Nigeria" },
                    description: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
      responses: { "201": { description: "Library document created." } },
    },
  },

  "/admin/library/{id}": {
    get: {
      tags: ["Library Management"],
      summary: "Get any document",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Document with uploadedBy populated." } },
    },
    patch: {
      tags: ["Library Management"],
      summary: "Update any document",
      description: "Updatable: title, subject, type, isLibraryContent, metadata.",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                subject: { type: "string" },
                type: { type: "string" },
                isLibraryContent: { type: "boolean" },
                metadata: { type: "object" },
              },
            },
          },
        },
      },
      responses: { "200": { description: "Document updated." } },
    },
    delete: {
      tags: ["Library Management"],
      summary: "Delete any document",
      description: "Deletes from both S3 and the database. Permanent.",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Document deleted." } },
    },
  },

  "/admin/library/{id}/promote": {
    patch: {
      tags: ["Library Management"],
      summary: "Promote user upload to platform library",
      description:
        "Sets isLibraryContent: true. Optionally update title, subject, type, and metadata in the same request.",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                subject: { type: "string" },
                type: { type: "string" },
                metadata: { type: "object" },
              },
            },
          },
        },
      },
      responses: { "200": { description: "Document promoted to platform library." } },
    },
  },

  "/admin/library/{id}/demote": {
    patch: {
      tags: ["Library Management"],
      summary: "Remove document from platform library",
      description: "Sets isLibraryContent: false. Document remains in the database.",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Document removed from library." } },
    },
  },

  "/admin/library/{id}/access": {
    get: {
      tags: ["Library Management"],
      summary: "Get signed download URL for any document",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Returns signedUrl (1-hour expiry) and expiresIn." } },
    },
  },

  // ─── Waitlist ──────────────────────────────────────────────────────────────

  "/admin/waitlist": {
    get: {
      tags: ["Waitlist Management"],
      summary: "List waitlist entries",
      parameters: [
        {
          in: "query",
          name: "search",
          schema: { type: "string" },
          description: "Search firstName, email, universityName",
        },
        { in: "query", name: "country", schema: { type: "string" } },
        { in: "query", name: "level", schema: { type: "string" } },
        { in: "query", name: "page", schema: { type: "integer", default: 1 } },
        { in: "query", name: "limit", schema: { type: "integer", default: 20 } },
      ],
      responses: { "200": { description: "Paginated list of waitlist entries." } },
    },
  },

  "/admin/waitlist/stats": {
    get: {
      tags: ["Waitlist Management"],
      summary: "Waitlist statistics",
      description:
        "Total count, top 10 countries, by study level, top 20 universities, and daily signup chart (30 days).",
      responses: { "200": { description: "Waitlist stats object." } },
    },
  },

  "/admin/waitlist/{id}": {
    get: {
      tags: ["Waitlist Management"],
      summary: "Get a waitlist entry",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Waitlist entry." },
        "404": { description: "Not found." },
      },
    },
    delete: {
      tags: ["Waitlist Management"],
      summary: "Remove a waitlist entry",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Entry removed." } },
    },
  },

  // ─── Support ───────────────────────────────────────────────────────────────

  "/admin/support/users/{id}": {
    get: {
      tags: ["Support"],
      summary: "View full user profile",
      description:
        "Returns the user object plus aggregated stats: note count, attempt count, research sessions, AI conversations, referral count, latest reasoning score.",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "{ user, stats }." },
        "404": { description: "Not found." },
      },
    },
  },

  "/admin/support/users/{id}/activity": {
    get: {
      tags: ["Support"],
      summary: "View user's recent activity",
      description:
        "Last 30 days of question attempts, case explanations, research sessions, AI conversations, and daily progress records.",
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string" } },
        { in: "query", name: "page", schema: { type: "integer", default: 1 } },
        { in: "query", name: "limit", schema: { type: "integer", default: 30 } },
      ],
      responses: { "200": { description: "Recent activity grouped by type." } },
    },
  },

  "/admin/support/users/{id}/notes": {
    get: {
      tags: ["Support"],
      summary: "View user's notes",
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string" } },
        { in: "query", name: "page", schema: { type: "integer", default: 1 } },
        { in: "query", name: "limit", schema: { type: "integer", default: 20 } },
      ],
      responses: { "200": { description: "Paginated notes." } },
    },
  },

  "/admin/support/users/{id}/attempts": {
    get: {
      tags: ["Support"],
      summary: "View user's question attempts",
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string" } },
        { in: "query", name: "page", schema: { type: "integer", default: 1 } },
        { in: "query", name: "limit", schema: { type: "integer", default: 20 } },
      ],
      responses: { "200": { description: "Paginated attempts with question details." } },
    },
  },

  "/admin/support/users/{id}/research": {
    get: {
      tags: ["Support"],
      summary: "View user's research sessions",
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string" } },
        { in: "query", name: "page", schema: { type: "integer", default: 1 } },
        { in: "query", name: "limit", schema: { type: "integer", default: 20 } },
      ],
      responses: { "200": { description: "Paginated research sessions." } },
    },
  },

  // ─── Firm admin ─────────────────────────────────────────────────────────────
  // The law firms who pay for LegalErrand, as opposed to the consumer routes
  // above, which are about people using the Academy app. Reading needs
  // super_admin, firm_admin or support_admin; changing a firm needs the first
  // two.

  "/admin/firms": {
    get: {
      tags: ["Firm admin"],
      summary: "List firms",
      description:
        "Every firm with its plan, commercial status, seats, MRR and a computed health score. Filter by `status`, `plan`, `country`, `state` and `q` (name or contact email); sort by `sort` (name, plan, mrr, seats, createdAt) and `dir` (asc, desc).",
      parameters: [
        { name: "page", in: "query", schema: { type: "integer", default: 1 } },
        { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 200 } },
        {
          name: "status",
          in: "query",
          schema: {
            type: "string",
            enum: ["trialing", "active", "past_due", "churned", "suspended"],
          },
        },
        {
          name: "plan",
          in: "query",
          schema: { type: "string", enum: ["starter", "practice", "firm", "enterprise"] },
        },
        { name: "country", in: "query", schema: { type: "string" } },
        { name: "state", in: "query", schema: { type: "string" } },
        { name: "q", in: "query", schema: { type: "string" } },
        { name: "sort", in: "query", schema: { type: "string", default: "mrr" } },
        { name: "dir", in: "query", schema: { type: "string", enum: ["asc", "desc"] } },
      ],
      responses: {
        "200": { description: "Paginated firms." },
        "403": { description: "Role may not open the firm admin." },
      },
    },
  },

  "/admin/firms/metrics": {
    get: {
      tags: ["Firm admin"],
      summary: "Commercial metrics",
      description:
        "MRR, ARR, average per paying firm, churn rate, seats sold against seats used, revenue at risk from failed payments, trials running and trials ending within three days, plus a breakdown by plan.",
      responses: { "200": { description: "Metrics object." } },
    },
  },

  "/admin/firms/plans": {
    get: {
      tags: ["Firm admin"],
      summary: "Plan catalogue",
      description:
        "The plans a firm can be on, with their naira price and included seats. Enterprise has no list price — it is negotiated and the agreed figure lives on the firm's subscription.",
      responses: { "200": { description: "Plans." } },
    },
  },

  "/admin/firms/{id}": {
    get: {
      tags: ["Firm admin"],
      summary: "One firm",
      description:
        "Everything in the list row, plus address, registration number, AI autonomy settings and subscription dates. The health score comes with the four parts it is made of, so it is never unexplained.",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Firm." },
        "404": { description: "No such firm." },
      },
    },
  },

  "/admin/firms/{id}/people": {
    get: {
      tags: ["Firm admin"],
      summary: "People at a firm",
      description:
        "Members with their role, whether they have taken up their seat, when they last signed in, and their standing at the bar. Metadata only — no client or matter content.",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Members." } },
    },
  },

  // ─── Firm admin: money ──────────────────────────────────────────────────────

  "/admin/firms/revenue": {
    get: {
      tags: ["Firm admin"],
      summary: "Revenue",
      description:
        "Current MRR, ARR and average per paying firm, twelve months of **invoiced and collected** amounts, what moved this month, a breakdown by plan, and the money at risk behind failed invoices. `mrrHistoryRetained` is false: MRR is not snapshotted, so the series is collections — money that actually arrived — rather than a reconstruction of what MRR used to be.",
      responses: { "200": { description: "Revenue." } },
    },
  },

  "/admin/firms/{id}/invoices": {
    get: {
      tags: ["Firm admin"],
      summary: "A firm's invoices",
      description:
        "Up to two years of invoices, newest first, each with how many attempts it took to collect and why the last attempt failed if it did.",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Invoices." } },
    },
  },

  "/admin/firms/{id}/plan": {
    patch: {
      tags: ["Firm admin"],
      summary: "Change a firm's plan",
      description:
        "Seats and price follow the catalogue, except on Enterprise, which has no list price — `mrr` is required there, or the firm would silently drop to zero. A firm is never left with fewer seats than people already using it. Writes an audit row.",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["plan"],
              properties: {
                plan: { type: "string", enum: ["starter", "practice", "firm", "enterprise"] },
                mrr: { type: "integer", description: "Naira per month. Required for enterprise." },
                seats: { type: "integer" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Changed." },
        "400": { description: "Unknown plan, or Enterprise without an agreed price." },
        "403": { description: "Support may read the firm admin but not change a firm." },
        "409": { description: "The firm has no subscription yet." },
      },
    },
  },

  "/admin/firms/{id}/status": {
    patch: {
      tags: ["Firm admin"],
      summary: "Suspend or reactivate a firm",
      description:
        "Suspending stops the firm's people signing in; reactivating puts them back. Writes an audit row either way.",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["action"],
              properties: {
                action: { type: "string", enum: ["suspend", "reactivate"] },
                reason: { type: "string" },
              },
            },
          },
        },
      },
      responses: { "200": { description: "Changed." }, "403": { description: "Not permitted." } },
    },
  },

  "/admin/firms/{id}/trial/extend": {
    post: {
      tags: ["Firm admin"],
      summary: "Extend a trial by seven days",
      description:
        "Extends from today when the trial has already lapsed, and from its end date when it has not — so a week always means a week from now. Writes an audit row.",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Extended." },
        "409": { description: "The firm is not on a trial." },
      },
    },
  },

  "/admin/firms/{id}/payment/retry": {
    post: {
      tags: ["Firm admin"],
      summary: "Retry a failed payment",
      description:
        "**Records the attempt; collects nothing.** No payment provider is connected to this API, so the attempt is written as pending and the subscription is left where it is. Returns 202 and says so. Writes an audit row.",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "202": { description: "Attempt recorded, nothing collected." },
        "409": { description: "No failed invoice to retry." },
      },
    },
  },

  "/admin/firms/{id}/access-request": {
    post: {
      tags: ["Firm admin"],
      summary: "Ask a firm for access to its workspace",
      description:
        "**Records the request; grants nothing.** The owner is not notified and no access is given — that flow does not exist yet. What this does give you is an auditable record of who asked for access to whom, and why. Returns 202.",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: { "202": { description: "Request recorded." } },
    },
  },

  // ─── Firm admin: what people did ────────────────────────────────────────────

  "/admin/firms/{id}/activity": {
    get: {
      tags: ["Firm admin"],
      summary: "A firm's activity",
      description:
        "Who did what and when. **Metadata only** — matters and documents appear as reference numbers, and nothing a client said or a document contained is here. That is a promise to every firm, not an omission. Filter by `type`, `memberId` and `days`.",
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
        { name: "days", in: "query", schema: { type: "integer", default: 30, maximum: 365 } },
        { name: "type", in: "query", schema: { type: "string" } },
        { name: "memberId", in: "query", schema: { type: "string" } },
      ],
      responses: { "200": { description: "Paginated activity." } },
    },
  },

  "/admin/firms/activity": {
    get: {
      tags: ["Firm admin"],
      summary: "Activity across every firm",
      description:
        "The same metadata-only view, across the platform, filtered by `type`, `country`, `state` and `days`. The meta block carries the last 24 hours: actions, firms active, and failed sign-ins — the last being how an attack on a firm's accounts first shows up.",
      parameters: [
        { name: "days", in: "query", schema: { type: "integer", default: 30, maximum: 365 } },
        { name: "type", in: "query", schema: { type: "string" } },
        { name: "country", in: "query", schema: { type: "string" } },
        { name: "state", in: "query", schema: { type: "string" } },
      ],
      responses: { "200": { description: "Paginated activity." } },
    },
  },

  "/admin/firms/{id}/usage": {
    get: {
      tags: ["Firm admin"],
      summary: "What one firm uses",
      description:
        "Matters, documents, tasks, time entries and clients, plus activity by kind over the window. `aiCost` is null: nothing meters AI use against a provider yet, so it is absent rather than estimated.",
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
        { name: "days", in: "query", schema: { type: "integer", default: 30, maximum: 365 } },
      ],
      responses: { "200": { description: "Usage." } },
    },
  },

  "/admin/firms/usage": {
    get: {
      tags: ["Firm admin"],
      summary: "Load across the platform",
      description:
        "People and actions per day, actions by kind, and feature adoption as the share of firms that have done each kind of thing at all — not the share of actions, which one busy firm could carry on its own.",
      parameters: [
        { name: "days", in: "query", schema: { type: "integer", default: 30, maximum: 365 } },
      ],
      responses: { "200": { description: "Usage." } },
    },
  },

  "/admin/firms/geography": {
    get: {
      tags: ["Firm admin"],
      summary: "Where the firms are",
      description:
        "Firms, paying firms, MRR and people by country. Pass `country` to break that one country down by state or province; without it only the country totals come back, since every division of every country would be most of a gazetteer.",
      parameters: [{ name: "country", in: "query", schema: { type: "string" } }],
      responses: { "200": { description: "Geography." } },
    },
  },

  "/admin/firms/people": {
    get: {
      tags: ["Firm admin"],
      summary: "Everyone at every firm",
      description:
        "Members across the platform with their firm and location, filtered by `role`, `country`, `state` and a name or email search. The meta block counts seats paid for but never taken up.",
      parameters: [
        { name: "role", in: "query", schema: { type: "string" } },
        { name: "country", in: "query", schema: { type: "string" } },
        { name: "state", in: "query", schema: { type: "string" } },
        { name: "q", in: "query", schema: { type: "string" } },
      ],
      responses: { "200": { description: "Paginated people." } },
    },
  },

  // ─── Firm admin: support, notes and the record ──────────────────────────────

  "/admin/firms/tickets": {
    get: {
      tags: ["Firm admin"],
      summary: "Support tickets",
      description:
        "`view` is open, resolved or all. `satisfaction` is null because nothing collects it yet.",
      parameters: [
        {
          name: "view",
          in: "query",
          schema: { type: "string", enum: ["open", "resolved", "all"] },
        },
        { name: "firmId", in: "query", schema: { type: "string" } },
      ],
      responses: { "200": { description: "Tickets." } },
    },
  },

  "/admin/firms/tickets/{ticketId}": {
    patch: {
      tags: ["Firm admin"],
      summary: "Mark a ticket resolved",
      description: "Writes an audit row naming the ticket and the firm.",
      parameters: [{ name: "ticketId", in: "path", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Resolved." }, "404": { description: "No such ticket." } },
    },
  },

  "/admin/firms/{id}/notes": {
    get: {
      tags: ["Firm admin"],
      summary: "Private notes about a firm",
      description:
        "What the team knows that the numbers do not say. Visible to LegalErrand admins only — a firm never sees these.",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Notes." } },
    },
    post: {
      tags: ["Firm admin"],
      summary: "Add a note",
      description: "Up to 4000 characters. Writes an audit row; the note's text stays in the note.",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["body"],
              properties: { body: { type: "string" } },
            },
          },
        },
      },
      responses: { "201": { description: "Saved." }, "400": { description: "Empty or too long." } },
    },
  },

  "/admin/firms/audit": {
    get: {
      tags: ["Firm admin"],
      summary: "What admins and the system did",
      description:
        "Append-only. There is no endpoint that edits or deletes a row and there must never be one — the value of this log is that nobody can tidy it up afterwards. If a row is wrong, the fix is another row saying so. Filter by `firmId`.",
      parameters: [{ name: "firmId", in: "query", schema: { type: "string" } }],
      responses: { "200": { description: "Paginated audit rows." } },
    },
  },

  "/admin/firms/system": {
    get: {
      tags: ["Firm admin"],
      summary: "Platform health",
      description:
        "**Not instrumented.** Nothing in this API measures uptime, latency or error rates — there is no monitor and no metrics store. Rather than return invented figures that would look exactly like real ones, this returns `instrumented: false` and empty arrays, and the dashboard shows the screen as not instrumented.",
      responses: { "200": { description: "A stated absence of measurement." } },
    },
  },
};
