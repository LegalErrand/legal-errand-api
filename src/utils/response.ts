import { Response } from "express";
import { logger } from "./logger";

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  meta?: Record<string, unknown>;
  error?: string;
}

export const sendSuccess = <T>(
  res: Response,
  data: T,
  message = "Success",
  statusCode = 200,
  meta?: Record<string, unknown>
): Response => {
  const response: ApiResponse<T> = { success: true, message, data };
  if (meta) response.meta = meta;
  return res.status(statusCode).json(response);
};

export const sendError = (
  res: Response,
  message: string,
  statusCode = 500,
  error?: string | unknown,
  logContext?: Record<string, unknown>
): Response => {
  if (statusCode >= 500) {
    logger.logError(message, error, logContext);
  } else if (statusCode >= 400) {
    logger.warn(message, {
      statusCode,
      ...logContext,
      ...(error !== undefined && { error: typeof error === "string" ? error : undefined }),
    });
  }

  const errorDetail =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : undefined;

  const response: ApiResponse = { success: false, message };
  if (errorDetail && process.env.NODE_ENV !== "production") response.error = errorDetail;
  return res.status(statusCode).json(response);
};

export const sendCreated = <T>(res: Response, data: T, message = "Created successfully"): Response =>
  sendSuccess(res, data, message, 201);

export const sendNotFound = (res: Response, message = "Resource not found"): Response =>
  sendError(res, message, 404);

export const sendUnauthorized = (
  res: Response,
  message = "Unauthorized",
  logContext?: Record<string, unknown>
): Response => sendError(res, message, 401, undefined, logContext);

export const sendForbidden = (
  res: Response,
  message = "Forbidden",
  logContext?: Record<string, unknown>
): Response => sendError(res, message, 403, undefined, logContext);

export const sendBadRequest = (
  res: Response,
  message: string,
  error?: string | unknown,
  logContext?: Record<string, unknown>
): Response => sendError(res, message, 400, error, logContext);
