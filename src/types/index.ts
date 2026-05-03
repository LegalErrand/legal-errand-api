import { Request } from "express";
import { JwtPayload } from "jsonwebtoken";
import { Types } from "mongoose";
import {
  LawSubject,
  DifficultyLevel,
  QuestionType,
  SubscriptionTier,
  DocumentType,
  NoteSource,
} from "../utils/constants";

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface TokenPayload extends JwtPayload {
  userId: string;
  email: string;
  tier: SubscriptionTier;
}

export interface AuthRequest extends Request {
  user?: TokenPayload;
  file?: Express.Multer.File;
}

// ─── User ────────────────────────────────────────────────────────────────────

export interface IUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password: string;
  university?: string;
  yearOfStudy?: number;
  tier: SubscriptionTier;
  avatar?: string;
  isEmailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Document / Library ──────────────────────────────────────────────────────

export interface IDocument {
  _id: Types.ObjectId;
  title: string;
  type: DocumentType;
  subject?: LawSubject;
  s3Key: string;
  s3Url: string;
  fileSize: number;
  uploadedBy?: Types.ObjectId;       // null = platform library
  isLibraryContent: boolean;
  metadata: {
    court?: string;
    year?: number;
    citation?: string;
    jurisdiction?: string;
  };
  createdAt: Date;
}

// ─── Notes ───────────────────────────────────────────────────────────────────

export interface INote {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  content: string;                   // rich text (HTML from Tiptap)
  subject?: LawSubject;
  tags: string[];
  source: NoteSource;
  sourceRef?: string;                // document ID, case name, etc.
  qualityScore?: number;             // 0–100, set by AI
  folder?: string;
  linkedDocumentId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Questions ───────────────────────────────────────────────────────────────

export interface IQuestion {
  _id: Types.ObjectId;
  type: QuestionType;
  subject: LawSubject;
  difficulty: DifficultyLevel;
  prompt: string;
  modelAnswer?: string;
  tags: string[];
  createdAt: Date;
}

export interface IQuestionAttempt {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  questionId: Types.ObjectId;
  answer: string;
  scores: {
    issueIdentification: number;
    ruleStatement: number;
    application: number;
    conclusion: number;
    total: number;
  };
  aiFeedback: string;
  createdAt: Date;
}

// ─── Research ────────────────────────────────────────────────────────────────

export interface IResearchSession {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  query: string;
  refinedQuery?: string;
  results: ResearchResult[];
  memo?: string;
  qualityScore?: number;
  createdAt: Date;
}

export interface ResearchResult {
  documentId?: Types.ObjectId;
  title: string;
  snippet: string;
  relevanceScore: number;
  type: DocumentType;
  citation?: string;
}

// ─── AI / Chat ────────────────────────────────────────────────────────────────

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

export interface SocraticSession {
  sessionId: string;
  userId: string;
  topic: string;
  messages: ConversationMessage[];
  hintsUsed: number;
  mode: "socratic" | "standard";
  understanding?: number;            // 0–100
}

// ─── Progress / Dashboard ────────────────────────────────────────────────────

export interface IProgressEntry {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  date: string;                      // YYYY-MM-DD
  studyMinutes: number;
  aiQueriesCount: number;
  casesExplained: number;
  notesCreated: number;
  questionsAnswered: number;
  researchSessions: number;
  subjectActivity: Partial<Record<LawSubject, number>>;
  createdAt: Date;
}

// ─── Legal Reasoning Score ───────────────────────────────────────────────────

export interface IReasoningScore {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  overall: number;
  components: {
    issueIdentification: number;
    ruleApplication: number;
    legalAnalysis: number;
    caseCitation: number;
    consistency: number;
    improvementRate: number;
  };
  bySubject: Partial<Record<LawSubject, number>>;
  calculatedAt: Date;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginationQuery {
  page?: string;
  limit?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
