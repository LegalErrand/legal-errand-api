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

/**
 * Who may open the firm admin at all. Support is in, because answering a firm's
 * ticket means seeing that firm; changing anything about it is a separate
 * question — see requireFirmAdmin.
 */
export const requireFirmAdminRead = (
  req: AdminRequest,
  res: Response,
  next: NextFunction
): void => {
  const allowed = ["super_admin", "firm_admin", "support_admin"];
  if (!req.admin || !allowed.includes(req.admin.role)) {
    res.status(403).json({ success: false, message: "Firm admin access required" });
    return;
  }
  next();
};

/**
 * Who may change a firm: move its plan, extend its trial, retry its payment, or
 * suspend it. Support deliberately cannot — those are commercial decisions, and
 * a declined card is not a support ticket.
 */
export const requireFirmAdmin = (req: AdminRequest, res: Response, next: NextFunction): void => {
  const allowed = ["super_admin", "firm_admin"];
  if (!req.admin || !allowed.includes(req.admin.role)) {
    res.status(403).json({
      success: false,
      message: "Only a firm admin or a super admin can change a firm",
    });
    return;
  }
  next();
};
