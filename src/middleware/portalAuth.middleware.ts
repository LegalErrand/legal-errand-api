import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Client } from "../models/firm";
import { env } from "../config/env";
import { PortalAuthRequest, PortalTokenPayload } from "../types/portal";
import { sendUnauthorized, sendForbidden } from "../utils/response";

/** How long a portal link stays usable (LE-035). */
export const PORTAL_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Mints the bearer behind a one-time client portal link.
 *
 * Clients hold no password, so this token *is* the credential: it is scoped to
 * one client of one firm and expires after seven days.
 */
export const signPortalToken = (claims: {
  clientId: string;
  firmId: string;
  matterId?: string;
}): string =>
  jwt.sign(
    { ...claims, scope: "portal" } satisfies Omit<PortalTokenPayload, keyof jwt.JwtPayload>,
    env.JWT_SECRET,
    {
      expiresIn: PORTAL_TOKEN_TTL_SECONDS,
    }
  );

/**
 * Verifies a client-portal token and attaches its claims as `req.portal`.
 *
 * A firm session token carries `scope: "firm"` and is refused here, so a
 * lawyer's token cannot be replayed against the portal; conversely
 * `authenticateFirm` refuses anything that is not `scope: "firm"`, so a portal
 * token cannot reach firm routes. The two scopes never cross.
 *
 * Every portal controller reads `clientId` and `firmId` from these claims and
 * from nowhere else — never from a query string or body — so a client cannot
 * ask for another client's file.
 */
export const authenticatePortalClient = async (
  req: PortalAuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    sendUnauthorized(res, "No portal link token provided");
    return;
  }

  try {
    const decoded = jwt.verify(authHeader.split(" ")[1], env.JWT_SECRET) as PortalTokenPayload;

    if (decoded.scope !== "portal" || !decoded.clientId || !decoded.firmId) {
      sendForbidden(res, "This token is not valid for the client portal");
      return;
    }

    // One indexed lookup, scoped to the firm in the token, so a link stops
    // working as soon as the client record is archived or moved.
    const client = await Client.findOne({ _id: decoded.clientId, firmId: decoded.firmId })
      .select("status")
      .lean();

    if (!client) {
      sendUnauthorized(res, "This portal link is no longer valid");
      return;
    }

    if (client.status === "archived") {
      sendForbidden(res, "This portal is closed. Please contact the firm.");
      return;
    }

    req.portal = decoded;
    next();
  } catch {
    sendUnauthorized(res, "This portal link has expired. Ask the firm for a new one.");
  }
};
