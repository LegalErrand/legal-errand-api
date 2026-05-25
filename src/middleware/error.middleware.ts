import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";
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
  return {
    method: req.method,
    path: req.originalUrl,
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
  logger.warn("Route not found", requestContext(req));
  res.status(404).json({ success: false, message: "Route not found" });
};
