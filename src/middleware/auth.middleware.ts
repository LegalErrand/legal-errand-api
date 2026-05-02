import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AuthRequest, TokenPayload } from "../types";
import { sendUnauthorized } from "../utils/response";

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    sendUnauthorized(res, "No token provided");
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    req.user = decoded;
    next();
  } catch {
    sendUnauthorized(res, "Invalid or expired token");
  }
};

export const requirePremium = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user?.tier !== "premium") {
    res.status(403).json({
      success: false,
      message: "This feature requires a Premium subscription",
      upgradeUrl: "/api/v1/billing/upgrade",
    });
    return;
  }
  next();
};
