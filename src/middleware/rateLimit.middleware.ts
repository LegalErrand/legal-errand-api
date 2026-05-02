import { Response, NextFunction } from "express";
import { AuthRequest } from "../types";
import { redisService } from "../services/cache/redis.service";
import { REDIS_KEYS } from "../utils/constants";
import { AI_LIMITS } from "../config/deepseek";
import { sendError } from "../utils/response";

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
