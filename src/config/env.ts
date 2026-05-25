import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().default("5000"),

  // MongoDB
  MONGO_URI: z.string().min(1, "MONGO_URI is required"),

  // Redis
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // JWT
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),

  // AWS S3
  AWS_ACCESS_KEY_ID: z.string().min(1, "AWS_ACCESS_KEY_ID is required"),
  AWS_SECRET_ACCESS_KEY: z.string().min(1, "AWS_SECRET_ACCESS_KEY is required"),
  AWS_REGION: z.string().default("us-east-1"),
  AWS_S3_BUCKET: z.string().min(1, "AWS_S3_BUCKET is required"),

  // DeepSeek AI (OpenAI-compatible)
  DEEPSEEK_API_KEY: z.string().min(1, "DEEPSEEK_API_KEY is required"),
  DEEPSEEK_BASE_URL: z.string().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),

  // Rate limits
  FREE_AI_QUERIES_PER_DAY: z.string().default("10"),
  FREE_RESEARCH_SESSIONS_PER_DAY: z.string().default("5"),

  // App
  CLIENT_URL: z.string().default("http://localhost:3000"),
  BCRYPT_SALT_ROUNDS: z.string().default("12"),
  
  // Zoho Mail SMTP (OTP + transactional email)
  ZOHO_SMTP_HOST: z.string().default("smtp.zoho.com"),
  ZOHO_SMTP_PORT: z.string().default("465"),
  ZOHO_SMTP_SECURE: z.enum(["true", "false"]).default("true"),
  ZOHO_SMTP_USER: z.string().optional(),
  ZOHO_SMTP_PASS: z.string().optional(),
  ZOHO_MAIL_FROM: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  parsed.error.issues.forEach((issue) => {
    console.error(`   ${issue.path.join(".")}: ${issue.message}`);
  });
  process.exit(1);
}

export const env = parsed.data as z.infer<typeof envSchema>;
export type Env = z.infer<typeof envSchema>;
