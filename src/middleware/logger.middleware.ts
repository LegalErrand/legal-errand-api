import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";
import { isProbePath } from "../utils/probe-path";

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const detail = res.locals.logDetail as string | undefined;
    const requestId = res.locals.requestId as string | undefined;
    const prefix = requestId ? `[${requestId}] ` : "";
    const line = `${prefix}${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms${detail ? ` — ${detail}` : ""}`;

    if (res.statusCode >= 500) {
      logger.error(line);
    } else if (res.statusCode >= 400) {
      const log =
        res.statusCode === 404 && isProbePath(req.originalUrl) ? logger.debug : logger.warn;
      log(line);
    } else {
      logger.info(line);
    }
  });

  next();
};
