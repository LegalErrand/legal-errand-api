import { RedisClientType } from "redis";
import { getRedis } from "../../config/redis";
import { CACHE_TTL } from "../../utils/constants";
import { logger } from "../../utils/logger";

const COMMAND_TIMEOUT_MS = 500;

async function runRedis<T>(
  fallback: T,
  op: (client: RedisClientType) => Promise<T>,
  context: string
): Promise<T> {
  const client = getRedis();
  if (!client) return fallback;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      op(client),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Redis command timed out")), COMMAND_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    logger.error(`Redis ${context}:`, err);
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const redisService = {
  async get<T>(key: string): Promise<T | null> {
    const val = await runRedis<string | null>(null, (client) => client.get(key), `GET [${key}]`);
    if (!val) return null;
    try {
      return JSON.parse(val) as T;
    } catch {
      return null;
    }
  },

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    await runRedis(
      undefined,
      async (client) => {
        if (ttlSeconds) {
          await client.setEx(key, ttlSeconds, serialized);
        } else {
          await client.set(key, serialized);
        }
      },
      `SET [${key}]`
    );
  },

  async del(key: string): Promise<void> {
    await runRedis(
      undefined,
      async (client) => {
        await client.del(key);
      },
      `DEL [${key}]`
    );
  },

  async incr(key: string, ttlSeconds: number = CACHE_TTL.DAILY_COUNT): Promise<number> {
    return runRedis(
      0,
      async (client) => {
        const count = await client.incr(key);
        if (count === 1) {
          await client.expire(key, ttlSeconds);
        }
        return count;
      },
      `INCR [${key}]`
    );
  },

  async getCount(key: string): Promise<number> {
    const val = await runRedis<string | null>(
      null,
      (client) => client.get(key),
      `GETCOUNT [${key}]`
    );
    return val ? parseInt(val, 10) || 0 : 0;
  },

  async setConversation(sessionId: string, messages: unknown[]): Promise<void> {
    await this.set(`conv:${sessionId}`, messages, CACHE_TTL.CONVERSATION);
  },

  async getConversation(sessionId: string): Promise<unknown[] | null> {
    return this.get<unknown[]>(`conv:${sessionId}`);
  },

  async invalidatePattern(pattern: string): Promise<void> {
    await runRedis(
      undefined,
      async (client) => {
        const keys = await client.keys(pattern);
        if (keys.length > 0) {
          await client.del(keys);
        }
      },
      `PATTERN DEL [${pattern}]`
    );
  },
};
