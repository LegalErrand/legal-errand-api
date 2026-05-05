import app from "./app";
import { env } from "./config/env";
import { connectDB, disconnectDB } from "./config/db";
import { connectRedis, disconnectRedis } from "./config/redis";
import { logger } from "./utils/logger";

const PORT = parseInt(env.PORT);

const start = async () => {
  // Connect to MongoDB and Redis before starting the server
  await connectDB();
  await connectRedis();

  const server = app.listen(PORT, "0.0.0.0", () => {
    logger.info(`LegalErrand API running on port ${PORT} [${env.NODE_ENV}]`);
    logger.info(` Health check: http://127.0.0.1:${PORT}/api/v1/health`);
  });

  // ─── Graceful Shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully...`);
    server.close(async () => {
      await disconnectDB();
      await disconnectRedis();
      logger.info("All connections closed. Goodbye.");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled Rejection:", reason);
    shutdown("UnhandledRejection");
  });
};

start().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  logger.error(`Failed to start server: ${message}`);
  if (stack) logger.error(stack);
  process.exit(1);
});
