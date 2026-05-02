import { Response } from "express";

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
  error?: string
): Response => {
  const response: ApiResponse = { success: false, message };
  if (error && process.env.NODE_ENV !== "production") response.error = error;
  return res.status(statusCode).json(response);
};

export const sendCreated = <T>(res: Response, data: T, message = "Created successfully"): Response =>
  sendSuccess(res, data, message, 201);

export const sendNotFound = (res: Response, message = "Resource not found"): Response =>
  sendError(res, message, 404);

export const sendUnauthorized = (res: Response, message = "Unauthorized"): Response =>
  sendError(res, message, 401);

export const sendForbidden = (res: Response, message = "Forbidden"): Response =>
  sendError(res, message, 403);

export const sendBadRequest = (res: Response, message: string): Response =>
  sendError(res, message, 400);
