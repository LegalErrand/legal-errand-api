export const userPaths: Record<string, unknown> = {
  // ─── Health ────────────────────────────────────────────────────────────────

  "/health": {
    get: {
      tags: ["Health"],
      summary: "Health check",
      security: [],
      responses: { "200": { description: "API is running" } },
    },
  },

  // ─── Auth ──────────────────────────────────────────────────────────────────

  "/auth/register": {
    post: {
      tags: ["Auth"],
      summary: "Register a new account",
      description:
        "Creates an unverified account and sends a 6-digit OTP via ZeptoMail SMTP (Zoho/Resend fallback when configured). Re-registering with the same unverified email overwrites the pending account and sends a new OTP.",
      security: [],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["firstName", "lastName", "email", "password", "accountType"],
              properties: {
                firstName: { type: "string", example: "Chidi" },
                lastName: { type: "string", example: "Okafor" },
                email: { type: "string", format: "email", example: "chidi@unilag.edu.ng" },
                password: { type: "string", minLength: 8, example: "MyPass123!" },
                accountType: { type: "string", enum: ["Undergraduate", "Law School Student"] },
                referralCode: {
                  type: "string",
                  description: "Optional referral code from another user",
                },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Account created. OTP sent to email.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ApiSuccess" },
            },
          },
        },
        "400": { description: "Missing required fields or email already verified." },
        "500": { description: "Registration failed." },
      },
    },
  },

  "/auth/verify-email": {
    post: {
      tags: ["Auth"],
      summary: "Verify email with OTP",
      description: "Verifies the account and returns JWT access + refresh tokens.",
      security: [],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email", "otp"],
              properties: {
                email: { type: "string", example: "chidi@unilag.edu.ng" },
                otp: { type: "string", description: "6-digit OTP from email", example: "482910" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Email verified. Returns token, refreshToken, and user." },
        "401": { description: "OTP invalid or expired / incorrect." },
        "404": { description: "User not found." },
        "500": { description: "Email verification failed." },
      },
    },
  },

  "/auth/resend-verification-otp": {
    post: {
      tags: ["Auth"],
      summary: "Resend email verification OTP",
      security: [],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email"],
              properties: { email: { type: "string" } },
            },
          },
        },
      },
      responses: {
        "200": { description: "A new OTP has been sent to your email." },
        "400": { description: "Email is required / email already verified." },
        "404": { description: "User not found." },
        "500": { description: "Failed to resend OTP." },
      },
    },
  },

  "/auth/login": {
    post: {
      tags: ["Auth"],
      summary: "Login",
      security: [],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email", "password"],
              properties: {
                email: { type: "string", example: "chidi@unilag.edu.ng" },
                password: { type: "string", example: "MyPass123!" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Login successful. Returns token, refreshToken, and user." },
        "401": { description: "Incorrect password / suspended account." },
        "404": { description: "User not found." },
      },
    },
  },

  "/auth/refresh": {
    post: {
      tags: ["Auth"],
      summary: "Refresh access token",
      security: [],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["refreshToken"],
              properties: { refreshToken: { type: "string" } },
            },
          },
        },
      },
      responses: {
        "200": { description: "New access token returned." },
        "401": { description: "Invalid or expired refresh token." },
      },
    },
  },

  "/auth/me": {
    get: {
      tags: ["Auth"],
      summary: "Get current user",
      responses: {
        "200": { description: "Returns authenticated user object." },
        "401": { description: "Unauthorized." },
      },
    },
  },

  "/auth/logout": {
    post: {
      tags: ["Auth"],
      summary: "Logout",
      description: "Stateless — client should discard both tokens after calling this.",
      responses: { "200": { description: "Logged out successfully." } },
    },
  },

  "/auth/change-password": {
    put: {
      tags: ["Auth"],
      summary: "Change password",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["currentPassword", "newPassword"],
              properties: {
                currentPassword: { type: "string" },
                newPassword: { type: "string", minLength: 8 },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Password changed successfully." },
        "401": { description: "Current password incorrect." },
      },
    },
  },

  "/auth/forgot-password": {
    post: {
      tags: ["Auth"],
      summary: "Request password reset OTP",
      description:
        "Sends a password-reset OTP via ZeptoMail SMTP (Zoho/Resend fallback) when the user exists.",
      security: [],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email"],
              properties: { email: { type: "string" } },
            },
          },
        },
      },
      responses: {
        "200": { description: "OTP generated and emailed." },
        "400": { description: "Email is required." },
        "404": { description: "User not found." },
        "500": { description: "Failed to process forgot password." },
      },
    },
  },

  "/auth/verify-otp": {
    post: {
      tags: ["Auth"],
      summary: "Verify password reset OTP",
      security: [],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email", "otp"],
              properties: { email: { type: "string" }, otp: { type: "string" } },
            },
          },
        },
      },
      responses: {
        "200": { description: "OTP verified. Returns short-lived resetToken (15 min)." },
        "401": { description: "OTP invalid or expired / incorrect." },
        "404": { description: "User not found." },
        "500": { description: "Failed to verify OTP." },
      },
    },
  },

  "/auth/reset-password": {
    post: {
      tags: ["Auth"],
      summary: "Reset password with token",
      security: [],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["resetToken", "newPassword"],
              properties: {
                resetToken: { type: "string" },
                newPassword: { type: "string", minLength: 8 },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Password reset successfully." },
        "401": { description: "Invalid or expired reset token." },
      },
    },
  },

  // ─── User ──────────────────────────────────────────────────────────────────

  "/user/bio-data": {
    put: {
      tags: ["User"],
      summary: "Update profile / bio data",
      description: "Completes or updates the user's onboarding profile.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                username: { type: "string" },
                firstName: { type: "string" },
                lastName: { type: "string" },
                country: { type: "string" },
                city: { type: "string" },
                schoolName: { type: "string" },
                levelYear: { type: "string", example: "300 Level" },
                matricNumber: { type: "string" },
                phoneNumber: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Profile updated successfully." },
        "401": { description: "Unauthorized." },
      },
    },
  },

  "/user/avatar": {
    put: {
      tags: ["User"],
      summary: "Update avatar",
      description:
        "First get a presigned URL from /library/upload-url (AVATARS folder), upload directly to S3, then call this endpoint with the resulting s3Key and URL.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["avatar", "s3Key"],
              properties: {
                avatar: { type: "string", description: "Public S3 URL of the avatar" },
                s3Key: { type: "string", description: "S3 key of the uploaded avatar" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Avatar updated." },
        "400": { description: "avatar and s3Key are required." },
      },
    },
  },

  "/user/avatar-url": {
    get: {
      tags: ["User"],
      summary: "Get signed avatar URL",
      description: "Returns a temporary signed URL to display the user's avatar (1-hour expiry).",
      responses: {
        "200": { description: "Returns signedUrl and expiresIn." },
        "404": { description: "No avatar set." },
      },
    },
  },

  "/user/referral": {
    get: {
      tags: ["User"],
      summary: "Get referral info",
      description:
        "Returns the user's unique referral key, a ready-to-share link, and the list of users they referred.",
      responses: {
        "200": {
          description: "Returns referralKey, referralLink, referredCount, referredUsers[].",
        },
        "404": { description: "User not found." },
      },
    },
  },

  // ─── Library ───────────────────────────────────────────────────────────────

  "/library": {
    get: {
      tags: ["Library"],
      summary: "Browse platform library",
      parameters: [
        {
          in: "query",
          name: "subject",
          schema: {
            type: "string",
            enum: [
              "Contract Law",
              "Criminal Law",
              "Tort Law",
              "Constitutional Law",
              "Property Law",
              "Evidence Law",
              "Jurisprudence",
              "Commercial Law",
              "Equity & Trusts",
              "Administrative Law",
              "Family Law",
              "International Law",
            ],
          },
        },
        {
          in: "query",
          name: "type",
          schema: {
            type: "string",
            enum: ["case_law", "statute", "textbook", "study_guide", "exam_paper", "user_upload"],
          },
        },
        { in: "query", name: "search", schema: { type: "string" } },
        { in: "query", name: "page", schema: { type: "integer", default: 1 } },
        { in: "query", name: "limit", schema: { type: "integer", default: 20 } },
      ],
      responses: { "200": { description: "Paginated list of platform library documents." } },
    },
  },

  "/library/bookmarks": {
    get: {
      tags: ["Library"],
      summary: "Get my bookmarked documents",
      parameters: [
        { in: "query", name: "page", schema: { type: "integer", default: 1 } },
        { in: "query", name: "limit", schema: { type: "integer", default: 20 } },
      ],
      responses: { "200": { description: "Paginated list of bookmarked documents." } },
    },
  },

  "/library/my-documents": {
    get: {
      tags: ["Library"],
      summary: "Get my uploaded documents",
      parameters: [
        { in: "query", name: "search", schema: { type: "string" } },
        { in: "query", name: "page", schema: { type: "integer", default: 1 } },
        { in: "query", name: "limit", schema: { type: "integer", default: 20 } },
      ],
      responses: { "200": { description: "Paginated list of user's own uploads." } },
    },
  },

  "/library/upload-url": {
    post: {
      tags: ["Library"],
      summary: "Get presigned S3 upload URL (single file)",
      description:
        "Returns a presigned PUT URL. Upload the file directly from the client, then call /library/upload/complete to save the record.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["fileName", "mimeType"],
              properties: {
                fileName: { type: "string", example: "tort-law-notes.pdf" },
                mimeType: { type: "string", example: "application/pdf" },
                folder: {
                  type: "string",
                  enum: ["DOCUMENTS", "LIBRARY", "AVATARS"],
                  default: "DOCUMENTS",
                },
              },
            },
          },
        },
      },
      responses: { "200": { description: "Returns uploadUrl, s3Key, s3Url, expiresIn (300s)." } },
    },
  },

  "/library/upload-urls/bulk": {
    post: {
      tags: ["Library"],
      summary: "Get presigned S3 upload URLs (bulk, max 20)",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["files"],
              properties: {
                files: {
                  type: "array",
                  maxItems: 20,
                  items: {
                    type: "object",
                    required: ["fileName", "mimeType"],
                    properties: {
                      fileName: { type: "string" },
                      mimeType: { type: "string" },
                    },
                  },
                },
                folder: {
                  type: "string",
                  enum: ["DOCUMENTS", "LIBRARY", "AVATARS"],
                  default: "DOCUMENTS",
                },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Array of { uploadUrl, s3Key, s3Url, fileName } per file." },
      },
    },
  },

  "/library/upload/complete": {
    post: {
      tags: ["Library"],
      summary: "Save single upload metadata",
      description:
        "Call this after a successful S3 upload to persist the document record in the database.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["title", "s3Key", "s3Url", "fileSize"],
              properties: {
                title: { type: "string" },
                subject: { type: "string" },
                s3Key: { type: "string" },
                s3Url: { type: "string" },
                fileSize: { type: "number", description: "File size in bytes" },
              },
            },
          },
        },
      },
      responses: { "201": { description: "Document saved." } },
    },
  },

  "/library/upload/complete/bulk": {
    post: {
      tags: ["Library"],
      summary: "Save bulk upload metadata (max 20)",
      description: "Validates all entries first, then saves all in a single database write.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["documents"],
              properties: {
                documents: {
                  type: "array",
                  maxItems: 20,
                  items: {
                    type: "object",
                    required: ["title", "s3Key", "s3Url", "fileSize"],
                    properties: {
                      title: { type: "string" },
                      subject: { type: "string" },
                      s3Key: { type: "string" },
                      s3Url: { type: "string" },
                      fileSize: { type: "number" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      responses: { "201": { description: "All documents saved. Returns count and documents[]." } },
    },
  },

  "/library/{id}": {
    get: {
      tags: ["Library"],
      summary: "Get document details",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Document details." },
        "403": { description: "Access denied (private document not owned by user)." },
        "404": { description: "Not found." },
      },
    },
    patch: {
      tags: ["Library"],
      summary: "Update own document",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                subject: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Document updated." },
        "403": { description: "Not owner." },
      },
    },
    delete: {
      tags: ["Library"],
      summary: "Delete own document",
      description: "Deletes the document from both S3 and the database.",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Document deleted." },
        "403": { description: "Not owner." },
      },
    },
  },

  "/library/{id}/access": {
    get: {
      tags: ["Library"],
      summary: "Get signed download URL",
      description:
        "Returns a temporary signed URL for viewing/downloading the document (1-hour expiry).",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Returns signedUrl and expiresIn (3600)." } },
    },
  },

  "/library/{id}/bookmark": {
    post: {
      tags: ["Library"],
      summary: "Toggle document bookmark",
      description: "Adds the bookmark if not present, removes it if already bookmarked.",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Returns { bookmarked: true/false }." } },
    },
  },

  // ─── Notes ─────────────────────────────────────────────────────────────────

  "/notes": {
    get: {
      tags: ["Notes"],
      summary: "List notes",
      parameters: [
        { in: "query", name: "subject", schema: { type: "string" } },
        { in: "query", name: "folder", schema: { type: "string" } },
        { in: "query", name: "tag", schema: { type: "string" } },
        { in: "query", name: "search", schema: { type: "string" } },
        { in: "query", name: "page", schema: { type: "integer", default: 1 } },
        { in: "query", name: "limit", schema: { type: "integer", default: 20 } },
      ],
      responses: { "200": { description: "Paginated list of user's notes." } },
    },
    post: {
      tags: ["Notes"],
      summary: "Create a note",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["title", "content"],
              properties: {
                title: { type: "string" },
                content: { type: "string", description: "Rich text HTML (from Tiptap)" },
                subject: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
                folder: { type: "string", default: "General" },
                source: {
                  type: "string",
                  enum: ["manual", "ai_response", "case_explainer", "quiz", "research", "socratic"],
                  default: "manual",
                },
                sourceRef: { type: "string" },
                linkedDocumentId: { type: "string" },
              },
            },
          },
        },
      },
      responses: { "201": { description: "Note created." } },
    },
  },

  "/notes/templates": {
    get: {
      tags: ["Notes"],
      summary: "Get note templates",
      description:
        "Returns 6 static templates: blank, IRAC, case brief, statute summary, research memo, lecture note.",
      responses: {
        "200": {
          description: "Array of template objects with id, name, description, and starter content.",
        },
      },
    },
  },

  "/notes/folders": {
    get: {
      tags: ["Notes"],
      summary: "Get user's note folders",
      responses: { "200": { description: "Array of folder names with note counts." } },
    },
  },

  "/notes/{id}": {
    get: {
      tags: ["Notes"],
      summary: "Get a single note",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Note object." }, "404": { description: "Not found." } },
    },
    put: {
      tags: ["Notes"],
      summary: "Update a note",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                content: { type: "string" },
                subject: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
                folder: { type: "string" },
              },
            },
          },
        },
      },
      responses: { "200": { description: "Updated note." } },
    },
    delete: {
      tags: ["Notes"],
      summary: "Delete a note",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Note deleted." } },
    },
  },

  "/notes/{id}/analyze": {
    post: {
      tags: ["Notes"],
      summary: "AI quality analysis",
      description: "Scores note quality (0–100) and provides improvement feedback. Rate-limited.",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Returns qualityScore and qualityFeedback saved on the note." },
      },
    },
  },

  "/notes/{id}/summarize": {
    post: {
      tags: ["Notes"],
      summary: "AI summarize note",
      description: "Generates bullet-point key takeaways from the note. Rate-limited.",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Returns summary string." } },
    },
  },

  "/notes/{id}/expand": {
    post: {
      tags: ["Notes"],
      summary: "AI expand note",
      description:
        "Elaborates on the note content with Nigerian legal context and examples. Rate-limited.",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Returns expanded content." } },
    },
  },

  "/notes/{id}/related": {
    get: {
      tags: ["Notes"],
      summary: "Get related notes",
      description: "Finds other notes by the user sharing the same subject or tags.",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Array of related notes." } },
    },
  },

  // ─── Questions ─────────────────────────────────────────────────────────────

  "/questions": {
    get: {
      tags: ["Questions"],
      summary: "List questions",
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
        { in: "query", name: "page", schema: { type: "integer", default: 1 } },
        { in: "query", name: "limit", schema: { type: "integer", default: 20 } },
      ],
      responses: { "200": { description: "Paginated list of active questions." } },
    },
  },

  "/questions/random": {
    get: {
      tags: ["Questions"],
      summary: "Get a random question",
      description:
        "Used for the Today's Challenge feature. Optionally filter by subject or difficulty.",
      parameters: [
        { in: "query", name: "subject", schema: { type: "string" } },
        {
          in: "query",
          name: "difficulty",
          schema: { type: "string", enum: ["beginner", "intermediate", "advanced"] },
        },
      ],
      responses: { "200": { description: "A single random active question." } },
    },
  },

  "/questions/stats": {
    get: {
      tags: ["Questions"],
      summary: "Get my question stats",
      description:
        "Aggregated attempt counts and average scores grouped by subject, difficulty, and type.",
      responses: { "200": { description: "Stats breakdown object." } },
    },
  },

  "/questions/my-attempts": {
    get: {
      tags: ["Questions"],
      summary: "Get all my attempts",
      parameters: [
        { in: "query", name: "page", schema: { type: "integer", default: 1 } },
        { in: "query", name: "limit", schema: { type: "integer", default: 20 } },
      ],
      responses: { "200": { description: "Paginated list of all the user's question attempts." } },
    },
  },

  "/questions/{id}": {
    get: {
      tags: ["Questions"],
      summary: "Get a single question",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Question object." },
        "404": { description: "Not found." },
      },
    },
  },

  "/questions/{id}/submit": {
    post: {
      tags: ["Questions"],
      summary: "Submit answer for AI grading",
      description:
        "AI grades using the IRAC rubric: Issue (25%), Rule (25%), Application (35%), Conclusion (15%).",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["answer"],
              properties: {
                answer: { type: "string", description: "The student's written answer" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description:
            "Returns scores { issueIdentification, ruleStatement, application, conclusion, total } and aiFeedback.",
        },
      },
    },
  },

  "/questions/{id}/attempts": {
    get: {
      tags: ["Questions"],
      summary: "Get my attempts for a specific question",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "All user attempts for that question, sorted newest first." },
      },
    },
  },

  // ─── Dashboard ─────────────────────────────────────────────────────────────

  "/dashboard": {
    get: {
      tags: ["Dashboard"],
      summary: "Get full dashboard",
      description:
        "Returns streak, 7-day stats, recent activity, subject mastery, active goals, and reasoning score. Cached 5 minutes in Redis.",
      responses: { "200": { description: "Full dashboard data object." } },
    },
  },

  "/dashboard/streak": {
    get: {
      tags: ["Dashboard"],
      summary: "Get streak calendar",
      description:
        "Returns current streak count and a 30-day activity calendar (true/false per day).",
      responses: { "200": { description: "{ streak, lastStudyDate, calendar[] }." } },
    },
  },

  "/dashboard/activity": {
    get: {
      tags: ["Dashboard"],
      summary: "Get activity feed",
      description:
        "Unified, chronological feed of question attempts, case explanations, and AI sessions.",
      parameters: [
        {
          in: "query",
          name: "type",
          schema: {
            type: "string",
            enum: ["all", "quizzes", "documents", "ai_sessions"],
            default: "all",
          },
        },
        { in: "query", name: "page", schema: { type: "integer", default: 1 } },
        { in: "query", name: "limit", schema: { type: "integer", default: 20 } },
      ],
      responses: {
        "200": { description: "Paginated activity items with type, title, score, createdAt." },
      },
    },
  },

  "/dashboard/achievements": {
    get: {
      tags: ["Dashboard"],
      summary: "Get achievements and badges",
      description:
        "Computes 17 badges across 5 categories: streak, quiz, learning, research, special.",
      responses: {
        "200": { description: "Array of { id, title, description, earned, earnedAt }." },
      },
    },
  },

  "/dashboard/insights": {
    get: {
      tags: ["Dashboard"],
      summary: "Get AI study insights",
      description: "AI generates 3 personalised insights from 7-day activity data. Cached 1 hour.",
      responses: { "200": { description: "Array of insight strings." } },
    },
  },

  "/dashboard/reasoning-score": {
    get: {
      tags: ["Dashboard"],
      summary: "Get Legal Reasoning Score",
      description:
        "Returns the latest overall score, component breakdown, by-subject scores, and 10-entry history.",
      responses: { "200": { description: "{ latest, history[] }." } },
    },
  },

  "/dashboard/goals": {
    get: {
      tags: ["Dashboard"],
      summary: "List study goals",
      responses: { "200": { description: "User's active and completed goals." } },
    },
    post: {
      tags: ["Dashboard"],
      summary: "Create a study goal",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["title", "targetValue", "unit"],
              properties: {
                title: { type: "string", example: "Complete 20 questions this week" },
                description: { type: "string" },
                targetValue: { type: "number", example: 20 },
                unit: {
                  type: "string",
                  enum: ["hours", "questions", "notes", "cases", "sessions", "flashcards"],
                },
                deadline: { type: "string", format: "date", example: "2025-05-16" },
              },
            },
          },
        },
      },
      responses: { "201": { description: "Goal created." } },
    },
  },

  "/dashboard/goals/{id}": {
    put: {
      tags: ["Dashboard"],
      summary: "Update a goal",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                currentValue: { type: "number" },
                targetValue: { type: "number" },
                deadline: { type: "string", format: "date" },
                isCompleted: { type: "boolean" },
              },
            },
          },
        },
      },
      responses: { "200": { description: "Goal updated." } },
    },
    delete: {
      tags: ["Dashboard"],
      summary: "Delete a goal",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Goal deleted." } },
    },
  },

  // ─── AI ────────────────────────────────────────────────────────────────────

  "/ai/chat": {
    post: {
      tags: ["AI — Chat"],
      summary: "Send a message to the AI assistant",
      description:
        "Nigerian law-specialised AI assistant. Rate-limited by daily quota (free: 10/day).",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["message"],
              properties: {
                message: { type: "string" },
                sessionId: { type: "string", description: "Omit to start a new conversation" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Returns { reply, sessionId }." },
        "429": { description: "Daily AI query limit reached." },
      },
    },
  },

  "/ai/chat/stream": {
    post: {
      tags: ["AI — Chat"],
      summary: "Send a message (streaming SSE)",
      description: "Same as /ai/chat but streams tokens via Server-Sent Events. Rate-limited.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["message"],
              properties: {
                message: { type: "string" },
                sessionId: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "SSE stream of token chunks." },
        "429": { description: "Daily limit reached." },
      },
    },
  },

  "/ai/conversations": {
    get: {
      tags: ["AI — Chat"],
      summary: "List conversation history",
      parameters: [
        { in: "query", name: "page", schema: { type: "integer", default: 1 } },
        { in: "query", name: "limit", schema: { type: "integer", default: 20 } },
      ],
      responses: {
        "200": {
          description:
            "Paginated list of past conversation sessions with title, messageCount, lastMessage.",
        },
      },
    },
  },

  "/ai/conversations/{sessionId}": {
    delete: {
      tags: ["AI — Chat"],
      summary: "Delete a conversation",
      description: "Removes from MongoDB and clears the Redis cache.",
      parameters: [{ in: "path", name: "sessionId", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Conversation deleted." } },
    },
  },

  "/ai/explain-case": {
    post: {
      tags: ["AI — Case Explainer"],
      summary: "Explain a legal case",
      description:
        "AI extracts structured fields: facts, issue, holding, reasoning, significance, relatedCases[], practiceQuestions[]. Result cached 24h in Redis and persisted to DB.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                documentId: { type: "string", description: "ID of a library document to explain" },
                text: { type: "string", description: "Raw case text (alternative to documentId)" },
                citation: { type: "string", example: "Donoghue v Stevenson [1932] AC 562" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Structured case breakdown." },
        "429": { description: "Daily AI limit reached." },
      },
    },
  },

  "/ai/case-explainer/history": {
    get: {
      tags: ["AI — Case Explainer"],
      summary: "List case explainer history",
      parameters: [
        { in: "query", name: "page", schema: { type: "integer", default: 1 } },
        { in: "query", name: "limit", schema: { type: "integer", default: 20 } },
      ],
      responses: { "200": { description: "Paginated list of past case explanations." } },
    },
  },

  "/ai/case-explainer/{id}": {
    get: {
      tags: ["AI — Case Explainer"],
      summary: "Get a single case explanation",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Full case explanation object." },
        "404": { description: "Not found." },
      },
    },
  },

  "/ai/case-explainer/{id}/save-to-notes": {
    post: {
      tags: ["AI — Case Explainer"],
      summary: "Save case explanation as a note",
      description: "Converts the structured explanation into a formatted HTML note.",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "201": { description: "Note created from case explanation." } },
    },
  },

  "/ai/socratic/start": {
    post: {
      tags: ["AI — Socratic Tutor"],
      summary: "Start a Socratic tutoring session",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["topic"],
              properties: {
                topic: { type: "string", example: "The neighbour principle in negligence" },
                subject: { type: "string", example: "Tort Law" },
              },
            },
          },
        },
      },
      responses: { "200": { description: "Returns sessionId and the AI's opening question." } },
    },
  },

  "/ai/socratic/respond": {
    post: {
      tags: ["AI — Socratic Tutor"],
      summary: "Respond in a Socratic session",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["sessionId", "message"],
              properties: {
                sessionId: { type: "string" },
                message: { type: "string" },
              },
            },
          },
        },
      },
      responses: { "200": { description: "Returns the AI's next question or guiding feedback." } },
    },
  },

  "/ai/socratic/end": {
    post: {
      tags: ["AI — Socratic Tutor"],
      summary: "End a Socratic session",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["sessionId"],
              properties: { sessionId: { type: "string" } },
            },
          },
        },
      },
      responses: {
        "200": { description: "Returns session summary and understanding score (0–100)." },
      },
    },
  },

  // ─── Research ──────────────────────────────────────────────────────────────

  "/research/search": {
    post: {
      tags: ["Research"],
      summary: "Search legal corpus",
      description:
        "AI refines the query and returns ranked results from the document library. Rate-limited (free: 5/day).",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["query"],
              properties: {
                query: { type: "string", example: "duty of care in Nigerian tort law" },
                jurisdiction: { type: "string", example: "Nigeria" },
                courtLevel: { type: "string", example: "Supreme Court" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Returns sessionId, refinedQuery, and results[]." },
        "429": { description: "Daily research limit reached." },
      },
    },
  },

  "/research/sessions": {
    get: {
      tags: ["Research"],
      summary: "List research sessions",
      parameters: [
        { in: "query", name: "page", schema: { type: "integer", default: 1 } },
        { in: "query", name: "limit", schema: { type: "integer", default: 20 } },
      ],
      responses: { "200": { description: "Paginated list of past research sessions." } },
    },
  },

  "/research/sessions/{id}": {
    get: {
      tags: ["Research"],
      summary: "Get a research session",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Full session with query, results, and memo." } },
    },
    delete: {
      tags: ["Research"],
      summary: "Delete a research session",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Session deleted." } },
    },
  },

  "/research/sessions/{sessionId}/memo": {
    post: {
      tags: ["Research"],
      summary: "Generate a research memo",
      description: "AI generates a structured legal research memo from the session results.",
      parameters: [{ in: "path", name: "sessionId", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Returns memo text saved on the session." } },
    },
  },

  "/research/sessions/{id}/save-to-notes": {
    post: {
      tags: ["Research"],
      summary: "Save a research result as a note",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["resultIndex"],
              properties: {
                resultIndex: {
                  type: "integer",
                  description: "Zero-based index into session.results[]",
                },
              },
            },
          },
        },
      },
      responses: { "201": { description: "Note created from research result." } },
    },
  },

  // ─── Waitlist ──────────────────────────────────────────────────────────────

  "/waitlist": {
    post: {
      tags: ["Waitlist"],
      summary: "Join the waitlist",
      description: "Public pre-launch signup. No authentication required.",
      security: [],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["firstName", "email", "universityName", "phone", "level", "country"],
              properties: {
                firstName: { type: "string", example: "Adaobi" },
                email: { type: "string", format: "email", example: "adaobi@unilag.edu.ng" },
                universityName: { type: "string", example: "University of Lagos" },
                phone: { type: "string", example: "+2348012345678" },
                level: { type: "string", example: "400 Level" },
                country: { type: "string", example: "Nigeria" },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Added to waitlist successfully.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: { $ref: "#/components/schemas/WaitlistEntry" },
                },
              },
            },
          },
        },
        "400": { description: "Missing required fields." },
        "409": { description: "Email is already on the waitlist." },
        "500": { description: "Server error while joining waitlist." },
      },
    },
  },
};
