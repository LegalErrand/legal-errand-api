import { getRedis } from "../../config/redis";
import { CACHE_TTL } from "../../utils/constants";
import { logger } from "../../utils/logger";

export const redisService = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const val = await getRedis().get(key);
      return val ? (JSON.parse(val) as T) : null;
    } catch (err) {
      logger.error(`Redis GET error [${key}]:`, err);
      return null;
    }
  },

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await getRedis().setEx(key, ttlSeconds, serialized);
      } else {
        await getRedis().set(key, serialized);
      }
    } catch (err) {
      logger.error(`Redis SET error [${key}]:`, err);
    }
  },

  async del(key: string): Promise<void> {
    try {
      await getRedis().del(key);
    } catch (err) {
      logger.error(`Redis DEL error [${key}]:`, err);
    }
  },

  async incr(key: string, ttlSeconds = CACHE_TTL.DAILY_COUNT): Promise<number> {
    try {
      const count = await getRedis().incr(key);
      if (count === 1) {
        // Set TTL only on first increment (key just created)
        await getRedis().expire(key, ttlSeconds);
      }
      return count;
    } catch (err) {
      logger.error(`Redis INCR error [${key}]:`, err);
      return 0;
    }
  },

  async getCount(key: string): Promise<number> {
    try {
      const val = await getRedis().get(key);
      return val ? parseInt(val) : 0;
    } catch {
      return 0;
    }
  },

  async setConversation(sessionId: string, messages: unknown[]): Promise<void> {
    const key = `conv:${sessionId}`;
    await this.set(key, messages, CACHE_TTL.CONVERSATION);
  },

  async getConversation(sessionId: string): Promise<unknown[] | null> {
    return this.get<unknown[]>(`conv:${sessionId}`);
  },

  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const keys = await getRedis().keys(pattern);
      if (keys.length > 0) {
        await getRedis().del(keys);
      }
    } catch (err) {
      logger.error(`Redis pattern delete error [${pattern}]:`, err);
    }
  },
};
