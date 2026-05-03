import { createClient, RedisClientType } from "redis";
import { env } from "./env";
import { logger } from "../utils/logger";

let redisClient: RedisClientType | null = null;
let redisAvailable = false;

export const connectRedis = async (): Promise<void> => {
  try {
    const client = createClient({ url: env.REDIS_URL }) as RedisClientType;

    client.on("error", (err) => {
      logger.error("Redis error:", err.message ?? err);
      redisAvailable = false;
    });

    client.on("connect", () => {
      logger.info("✅ Redis connected");
      redisAvailable = true;
    });

    client.on("reconnecting", () => logger.warn("Redis reconnecting..."));

    await client.connect();
    redisClient = client;
    redisAvailable = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`  Redis unavailable — running without cache. Reason: ${message}`);
    logger.warn("   Rate limiting and conversation memory will be disabled.");
    redisClient = null;
    redisAvailable = false;
  }
};

export const getRedis = (): RedisClientType | null => redisClient;

export const isRedisAvailable = (): boolean => redisAvailable;

export const disconnectRedis = async (): Promise<void> => {
  if (redisClient) {
    await redisClient.quit();
    logger.info("Redis disconnected gracefully");
  }
};
