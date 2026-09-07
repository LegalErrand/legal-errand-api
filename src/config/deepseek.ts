import OpenAI from "openai";
import { env } from "./env";

// DeepSeek is OpenAI-compatible — swap baseURL to migrate to Mistral later
export const aiClient = new OpenAI({
  apiKey: env.DEEPSEEK_API_KEY,
  baseURL: env.DEEPSEEK_BASE_URL,
});

export const AI_MODEL = env.DEEPSEEK_MODEL;

export const AI_LIMITS = {
  FREE_QUERIES_PER_DAY: parseInt(env.FREE_AI_QUERIES_PER_DAY),
  FREE_RESEARCH_SESSIONS_PER_DAY: parseInt(env.FREE_RESEARCH_SESSIONS_PER_DAY),
  MAX_TOKENS: {
    CHAT: 4096,
    CASE_EXPLAINER: 3000,
    RESEARCH_MEMO: 4000,
    NOTE_ANALYSIS: 1500,
    GRADING: 2000,
    SOCRATIC: 1000,
  },
} as const;
