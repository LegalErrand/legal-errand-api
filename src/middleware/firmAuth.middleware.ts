import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { FirmMember } from "../models/firm";
import { env } from "../config/env";
import { FirmAuthRequest, FirmTokenPayload } from "../types/firm";
import { sendUnauthorized, sendForbidden } from "../utils/response";

/**
 * Verifies a firm-app access token and attaches its claims as `req.member`.
 *
 * Tokens issued for the student app carry no `scope: "firm"` claim and are
 * rejected here, so a student token cannot reach firm data.
 */
export const authenticateFirm = async (
  req: FirmAuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    sendUnauthorized(res, "No token provided");
    return;
  }

  try {
    const decoded = jwt.verify(authHeader.split(" ")[1], env.JWT_SECRET) as FirmTokenPayload & {
      iat?: number;
    };

    // The sign-up and login-code tokens are deliberately not scope "firm", so a
    // half-finished sign-up or an unconfirmed login cannot reach firm data.
    if (decoded.scope !== "firm" || !decoded.memberId) {
      sendForbidden(res, "This token is not valid for the firm workspace");
      return;
    }

    // One indexed lookup so a password reset can end other sessions, and so a
    // deactivated member stops working before their token runs out.
    const member = await FirmMember.findById(decoded.memberId)
      .select("isActive passwordChangedAt")
      .lean();

    if (!member || member.isActive === false) {
      sendUnauthorized(res, "This account is no longer active");
      return;
    }

    if (member.passwordChangedAt && decoded.iat) {
      // iat is whole seconds, so compare at that resolution.
      if (Math.floor(member.passwordChangedAt.getTime() / 1000) > decoded.iat) {
        sendUnauthorized(res, "Your password changed. Log in again.");
        return;
      }
    }

    req.member = decoded;
    next();
  } catch {
    sendUnauthorized(res, "Invalid or expired token");
  }
};
