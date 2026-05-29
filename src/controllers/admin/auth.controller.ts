import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Admin } from "../../models/Admin";
import { env } from "../../config/env";
import { AdminRequest } from "../../types";
import { ApiMessage } from "../../utils/api-messages";
import {
  sendSuccess,
  sendBadRequest,
  sendUnauthorized,
  sendNotFound,
  sendError,
} from "../../utils/response";
import { logger } from "../../utils/logger";

const signAdminToken = (adminId: string, email: string, role: string) =>
  jwt.sign({ adminId, email, role, isAdmin: true }, env.JWT_SECRET, {
    expiresIn: "8h",
  } as jwt.SignOptions);

export const adminLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      sendBadRequest(res, ApiMessage.EMAIL_AND_PASSWORD_REQUIRED, undefined, {
        route: "adminLogin",
        reason: "missing_fields",
      });
      return;
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const admin = await Admin.findOne({ email: normalizedEmail }).select("+password");

    if (!admin) {
      logger.warn("Admin login failed", {
        email: normalizedEmail,
        reason: "no_account",
        hint: "Run: npx ts-node src/scripts/createSuperAdmin.ts",
      });
      sendNotFound(res, ApiMessage.ADMIN_NOT_FOUND, {
        email: normalizedEmail,
        reason: "no_account",
      });
      return;
    }

    if (!(await admin.comparePassword(password))) {
      logger.warn("Admin login failed", { email: normalizedEmail, reason: "invalid_password" });
      sendUnauthorized(res, ApiMessage.INCORRECT_PASSWORD, {
        email: normalizedEmail,
        reason: "invalid_password",
      });
      return;
    }

    if (admin.isBlocked) {
      logger.warn("Admin login blocked", {
        email: normalizedEmail,
        reason: "account_suspended",
        blockedReason: admin.blockedReason,
      });
      sendUnauthorized(res, ApiMessage.ADMIN_ACCOUNT_SUSPENDED, {
        email: normalizedEmail,
        reason: "account_suspended",
      });
      return;
    }

    admin.lastLogin = new Date();
    await admin.save();

    const token = signAdminToken(admin._id.toString(), admin.email, admin.role);
    const adminObj = admin.toJSON();

    logger.info("Admin login successful", { email: admin.email, role: admin.role });
    sendSuccess(res, { token, admin: adminObj }, ApiMessage.LOGIN_SUCCESS);
  } catch (err) {
    sendError(res, ApiMessage.LOGIN_FAILED, 500, err, { route: "adminLogin" });
  }
};

export const getAdminMe = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const admin = await Admin.findById(req.admin!.adminId);
    if (!admin) {
      sendNotFound(res, ApiMessage.ADMIN_NOT_FOUND);
      return;
    }
    sendSuccess(res, admin, ApiMessage.PROFILE_RETRIEVED);
  } catch (err) {
    sendError(res, ApiMessage.PROFILE_RETRIEVE_FAILED, 500, err);
  }
};

export const adminLogout = (_req: AdminRequest, res: Response): void => {
  sendSuccess(res, null, ApiMessage.LOGOUT_SUCCESS);
};
