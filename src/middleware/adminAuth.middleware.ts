import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AdminRequest, AdminTokenPayload } from "../types";
import { sendUnauthorized } from "../utils/response";

export const authenticateAdmin = (req: AdminRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    sendUnauthorized(res, "No token provided");
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as AdminTokenPayload;
    if (!decoded.isAdmin) {
      sendUnauthorized(res, "Not an admin token");
      return;
    }
    req.admin = decoded;
    next();
  } catch {
    sendUnauthorized(res, "Invalid or expired token");
  }
};

export const requireSuperAdmin = (req: AdminRequest, res: Response, next: NextFunction): void => {
  if (req.admin?.role !== "super_admin") {
    res.status(403).json({ success: false, message: "Super admin access required" });
    return;
  }
  next();
};

export const requireContentAdmin = (req: AdminRequest, res: Response, next: NextFunction): void => {
  const allowed = ["super_admin", "content_admin"];
  if (!req.admin || !allowed.includes(req.admin.role)) {
    res.status(403).json({ success: false, message: "Content admin access required" });
    return;
  }
  next();
};
