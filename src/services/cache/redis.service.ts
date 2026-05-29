import { getRedis } from "../../config/redis";
import { CACHE_TTL } from "../../utils/constants";
import { logger } from "../../utils/logger";

export const redisService = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const client = getRedis();
      if (!client) return null;
      const val = await client.get(key);
      return val ? (JSON.parse(val) as T) : null;
    } catch (err) {
      logger.error(`Redis GET error [${key}]:`, err);
      return null;
    }
  },

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    try {
      const client = getRedis();
      if (!client) return;
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await client.setEx(key, ttlSeconds, serialized);
      } else {
        await client.set(key, serialized);
      }
    } catch (err) {
      logger.error(`Redis SET error [${key}]:`, err);
    }
  },

  async del(key: string): Promise<void> {
    try {
      const client = getRedis();
      if (!client) return;
      await client.del(key);
    } catch (err) {
      logger.error(`Redis DEL error [${key}]:`, err);
    }
  },

  async incr(key: string, ttlSeconds: number = CACHE_TTL.DAILY_COUNT): Promise<number> {
    try {
      const client = getRedis();
      if (!client) return 0;
      const count = await client.incr(key);
      if (count === 1) {
        await client.expire(key, ttlSeconds);
      }
      return count;
    } catch (err) {
      logger.error(`Redis INCR error [${key}]:`, err);
      return 0;
    }
  },

  async getCount(key: string): Promise<number> {
    try {
      const client = getRedis();
      if (!client) return 0;
      const val = await client.get(key);
      return val ? parseInt(val) : 0;
    } catch {
      return 0;
    }
  },

  async setConversation(sessionId: string, messages: unknown[]): Promise<void> {
    await this.set(`conv:${sessionId}`, messages, CACHE_TTL.CONVERSATION);
  },

  async getConversation(sessionId: string): Promise<unknown[] | null> {
    return this.get<unknown[]>(`conv:${sessionId}`);
  },

  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const client = getRedis();
      if (!client) return;
      const keys = await client.keys(pattern);
      if (keys.length > 0) {
        await client.del(keys);
      }
    } catch (err) {
      logger.error(`Redis pattern delete error [${pattern}]:`, err);
    }
  },
};
