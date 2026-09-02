import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "../types";
import { redisService } from "../services/cache/redis.service";
import { REDIS_KEYS } from "../utils/constants";
import { AI_LIMITS } from "../config/deepseek";
import { sendError } from "../utils/response";

// ─── Auth IP rate limit ────────────────────────────────────────────────────────
// 60 requests per 15 minutes per IP across all auth endpoints.
// Falls back to allow if Redis is unavailable or slow (fail-open) so a cache
// outage can never hang or block sign-in.

const AUTH_IP_WINDOW_SECONDS = 15 * 60; // 15 minutes
const AUTH_IP_MAX_REQUESTS = 60;

export const authIpRateLimit = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
      req.ip ??
      req.socket.remoteAddress ??
      "unknown";

    const key = `auth_ip_rl:${ip}:${windowSlot()}`;
    const count = await redisService.incr(key, AUTH_IP_WINDOW_SECONDS);

    if (count > AUTH_IP_MAX_REQUESTS) {
      res.setHeader("Retry-After", AUTH_IP_WINDOW_SECONDS.toString());
      sendError(res, "Too many requests from this IP. Please try again in 15 minutes.", 429);
      return;
    }
  } catch {
    // Fail open: never block auth because rate limiting failed.
  }

  next();
};

/** Returns the current 15-minute window slot (e.g. "2026-05-27T14:30") */
function windowSlot(): string {
  const d = new Date();
  const slot = Math.floor(d.getMinutes() / 15) * 15;
  return `${d.toISOString().slice(0, 13)}:${slot.toString().padStart(2, "0")}`;
}

// ─── Per-user AI limits ────────────────────────────────────────────────────────

/**
 * Rate-limit AI queries per user per day (Free: 10, Premium: unlimited)
 */
export const aiQueryRateLimit = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const userId = req.user!.userId;
  const tier = req.user!.tier;

  if (tier === "premium") return next();

  const key = REDIS_KEYS.AI_QUERY_COUNT(userId);
  const count = await redisService.getCount(key);

  if (count >= AI_LIMITS.FREE_QUERIES_PER_DAY) {
    sendError(
      res,
      `Daily AI query limit reached (${AI_LIMITS.FREE_QUERIES_PER_DAY}/day on free tier). Upgrade to Premium for unlimited access.`,
      429
    );
    return;
  }

  await redisService.incr(key);
  next();
};

/**
 * Rate-limit research sessions per user per day (Free: 5, Premium: unlimited)
 */
export const researchRateLimit = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const userId = req.user!.userId;
  const tier = req.user!.tier;

  if (tier === "premium") return next();

  const key = REDIS_KEYS.RESEARCH_SESSION_COUNT(userId);
  const count = await redisService.getCount(key);

  if (count >= AI_LIMITS.FREE_RESEARCH_SESSIONS_PER_DAY) {
    sendError(
      res,
      `Daily research session limit reached (${AI_LIMITS.FREE_RESEARCH_SESSIONS_PER_DAY}/day on free tier). Upgrade to Premium for unlimited access.`,
      429
    );
    return;
  }

  await redisService.incr(key);
  next();
};
