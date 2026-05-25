export const SECURITY_SCHEMES = {
  bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
} as const;

export const swaggerComponents = {
  securitySchemes: SECURITY_SCHEMES,
  schemas: {
    ApiSuccess: {
      type: "object",
      properties: {
        success: { type: "boolean", example: true },
        message: { type: "string", example: "Success" },
        data: { description: "Response payload (shape varies by endpoint)" },
        meta: {
          type: "object",
          description: "Optional pagination or extra fields",
          additionalProperties: true,
        },
      },
    },
    ApiError: {
      type: "object",
      properties: {
        success: { type: "boolean", example: false },
        message: { type: "string", example: "Error message" },
        error: {
          type: "string",
          description: "Extra detail in non-production environments (mainly 5xx)",
        },
      },
    },
    WaitlistEntry: {
      type: "object",
      properties: {
        _id: { type: "string" },
        firstName: { type: "string" },
        email: { type: "string", format: "email" },
        universityName: { type: "string" },
        phone: { type: "string" },
        level: { type: "string", example: "400 Level" },
        country: { type: "string", example: "Nigeria" },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
      },
    },
    AdminAccount: {
      type: "object",
      properties: {
        _id: { type: "string" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        email: { type: "string", format: "email" },
        role: { type: "string", enum: ["super_admin", "content_admin", "support_admin"] },
        isBlocked: { type: "boolean" },
        lastLogin: { type: "string", format: "date-time" },
      },
    },
  },
};
