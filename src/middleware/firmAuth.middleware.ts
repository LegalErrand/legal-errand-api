import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { FirmMember, FirmAccessGrant, isGrantUsable } from "../models/firm";
import { env } from "../config/env";
import { FirmAuthRequest, FirmTokenPayload } from "../types/firm";
import { sendUnauthorized, sendForbidden } from "../utils/response";

/** Methods a read-only support session may use. Everything else is refused. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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

    // A support session minted against an access grant is read-only, and that
    // is enforced here rather than trusted to each controller. Anything but a
    // safe method is refused, so there is no route — existing or added later —
    // through which an admin looking into a firm can change its data.
    if (decoded.readOnly === true && !SAFE_METHODS.has(req.method.toUpperCase())) {
      sendForbidden(
        res,
        "This is a read-only support session. Nothing can be changed, sent or deleted with it."
      );
      return;
    }

    // Revoking a grant has to end the sessions it produced, not just stop new
    // ones being minted, so the grant is re-checked on every request.
    if (decoded.readOnly === true) {
      if (!decoded.grantId) {
        sendUnauthorized(res, "This support session is not valid");
        return;
      }
      const grant = await FirmAccessGrant.findById(decoded.grantId);
      if (!isGrantUsable(grant)) {
        sendUnauthorized(res, "That access has been revoked or has expired");
        return;
      }
    }

    req.member = decoded;
    next();
  } catch {
    sendUnauthorized(res, "Invalid or expired token");
  }
};
