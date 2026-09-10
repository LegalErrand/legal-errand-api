import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { FirmAuthRequest, FirmTokenPayload } from "../types/firm";
import { sendUnauthorized, sendForbidden } from "../utils/response";

/**
 * Verifies a firm-app access token and attaches its claims as `req.member`.
 *
 * Tokens issued for the student app carry no `scope: "firm"` claim and are
 * rejected here, so a student token cannot reach firm data.
 */
export const authenticateFirm = (req: FirmAuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    sendUnauthorized(res, "No token provided");
    return;
  }

  try {
    const decoded = jwt.verify(authHeader.split(" ")[1], env.JWT_SECRET) as FirmTokenPayload;

    if (decoded.scope !== "firm" || !decoded.memberId) {
      sendForbidden(res, "This token is not valid for the firm workspace");
      return;
    }

    req.member = decoded;
    next();
  } catch {
    sendUnauthorized(res, "Invalid or expired token");
  }
};
