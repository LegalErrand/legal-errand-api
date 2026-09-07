// Nigerian law subjects covered by the platform
export const LAW_SUBJECTS = [
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
] as const;

export type LawSubject = (typeof LAW_SUBJECTS)[number];

// Question types for the reasoning question bank
export const QUESTION_TYPES = ["hypothetical", "issue_spotting", "application"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

// Difficulty levels
export const DIFFICULTY_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

// User subscription tiers
export const SUBSCRIPTION_TIERS = ["free", "premium"] as const;
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];

// Document types in the library
export const DOCUMENT_TYPES = [
  "case_law",
  "statute",
  "textbook",
  "study_guide",
  "exam_paper",
  "user_upload",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

// Note sources — every note knows where it came from
export const NOTE_SOURCES = [
  "manual",
  "ai_response",
  "case_explainer",
  "quiz",
  "research",
  "socratic",
] as const;
export type NoteSource = (typeof NOTE_SOURCES)[number];

// Redis key prefixes
export const REDIS_KEYS = {
  AI_QUERY_COUNT: (userId: string) => `ai:queries:${userId}:${today()}`,
  RESEARCH_SESSION_COUNT: (userId: string) => `research:sessions:${userId}:${today()}`,
  CONVERSATION: (sessionId: string) => `conv:${sessionId}`,
  DASHBOARD_CACHE: (userId: string) => `dashboard:v2:${userId}`,
  USER_SESSION: (userId: string) => `session:${userId}`,
} as const;

// IRAC grading rubric weights
export const GRADING_RUBRIC = {
  ISSUE_IDENTIFICATION: 0.25,
  RULE_STATEMENT: 0.25,
  APPLICATION: 0.35,
  CONCLUSION: 0.15,
} as const;

// Cache TTLs in seconds
export const CACHE_TTL = {
  DASHBOARD: 300, // 5 minutes
  CONVERSATION: 3600, // 1 hour
  DAILY_COUNT: 86400, // 24 hours
  CASE_EXPLAINER: 86400, // 24 hours — case breakdowns don't change
  LIBRARY_LIST: 600, // 10 minutes
} as const;

function today(): string {
  return new Date().toISOString().split("T")[0];
}
