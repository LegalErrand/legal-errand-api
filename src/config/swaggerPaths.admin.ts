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
};
