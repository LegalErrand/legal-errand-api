import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const REQUEST_ID_HEADER = "x-request-id";

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const fromHeader = req.headers[REQUEST_ID_HEADER] as string | undefined;
  const requestId = (fromHeader && fromHeader.trim()) || crypto.randomUUID();

  (req as Request & { requestId?: string }).requestId = requestId;
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  next();
};
