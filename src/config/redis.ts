import { createClient, RedisClientType } from "redis";
import { env } from "./env";
import { logger } from "../utils/logger";

let redisClient: RedisClientType;

export const connectRedis = async (): Promise<RedisClientType> => {
  redisClient = createClient({ url: env.REDIS_URL }) as RedisClientType;

  redisClient.on("error", (err) => logger.error("Redis error:", err));
  redisClient.on("connect", () => logger.info("✅ Redis connected"));
  redisClient.on("reconnecting", () => logger.warn("Redis reconnecting..."));

  await redisClient.connect();
  return redisClient;
};

export const getRedis = (): RedisClientType => {
  if (!redisClient) {
    throw new Error("Redis client not initialized. Call connectRedis() first.");
  }
  return redisClient;
};

export const disconnectRedis = async (): Promise<void> => {
  if (redisClient) {
    await redisClient.quit();
    logger.info("Redis disconnected gracefully");
  }
};
