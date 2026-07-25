import { Request, Response, NextFunction } from "express";
import { ApiMessage } from "../utils/api-messages";
import { logger } from "../utils/logger";
import { isProbePath } from "../utils/probe-path";
import type { AdminRequest, AuthRequest } from "../types";

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

const requestContext = (req: Request): Record<string, unknown> => {
  const userReq = req as AuthRequest;
  const adminReq = req as AdminRequest;
  const requestId = (req as Request & { requestId?: string }).requestId;
  return {
    method: req.method,
    path: req.originalUrl,
    ...(requestId && { requestId }),
    ...(userReq.user?.userId && { userId: userReq.user.userId }),
    ...(adminReq.admin?.adminId && { adminId: adminReq.admin.adminId }),
  };
};

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const statusCode = (err as AppError).statusCode ?? 500;
  const message = err.message ?? "Internal server error";

  logger.logError(`[${statusCode}] ${message}`, err, requestContext(req));

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
};

export const notFoundHandler = (req: Request, res: Response): void => {
  const context = requestContext(req);
  const log = isProbePath(req.originalUrl) ? logger.debug : logger.warn;
  log("Route not found", context);
  res.status(404).json({ success: false, message: ApiMessage.ROUTE_NOT_FOUND });
};
