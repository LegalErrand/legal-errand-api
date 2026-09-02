import { createClient, RedisClientType } from "redis";
import { env } from "./env";
import { logger } from "../utils/logger";

const CONNECT_TIMEOUT_MS = 5_000;

let redisClient: RedisClientType | null = null;

export const connectRedis = async (): Promise<void> => {
  const client = createClient({
    url: env.REDIS_URL,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: CONNECT_TIMEOUT_MS,
      reconnectStrategy: (retries) => Math.min(retries * 250, 15_000),
    },
  }) as RedisClientType;

  client.on("error", (err) => {
    logger.error("Redis error:", err.message ?? err);
  });

  client.on("ready", () => {
    logger.info("Redis connected");
  });

  client.on("reconnecting", () => logger.warn("Redis reconnecting..."));

  client.on("end", () => {
    logger.warn("Redis connection closed");
  });

  redisClient = client;

  const connecting = client.connect().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`  Redis unavailable — running without cache. Reason: ${message}`);
    logger.warn("   Rate limiting and conversation memory will be disabled until Redis recovers.");
  });

  try {
    await Promise.race([
      connecting,
      new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error("Redis connect timed out")), CONNECT_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`  Redis not ready at startup — continuing without cache. Reason: ${message}`);
  }
};

export const getRedis = (): RedisClientType | null => {
  if (!redisClient?.isReady) return null;
  return redisClient;
};

export const isRedisAvailable = (): boolean => Boolean(redisClient?.isReady);

export const disconnectRedis = async (): Promise<void> => {
  if (!redisClient) return;
  try {
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
    logger.info("Redis disconnected gracefully");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Redis disconnect failed: ${message}`);
  } finally {
    redisClient = null;
  }
};
