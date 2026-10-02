import { Request } from "express";
import { JwtPayload } from "jsonwebtoken";

/**
 * Claims carried by a client-portal token (LE-035).
 *
 * Clients never hold a password: the firm mints one of these and emails it as a
 * one-time link. The scope is deliberately `"portal"` and never `"firm"`, so a
 * portal token cannot reach firm routes (`authenticateFirm` demands
 * `scope === "firm"`) and a firm token cannot reach portal routes
 * (`authenticatePortalClient` demands `scope === "portal"`).
 */
export interface PortalTokenPayload extends JwtPayload {
  clientId: string;
  firmId: string;
  /** Present when the link was minted for one matter rather than the client's whole file. */
  matterId?: string;
  scope: "portal";
}

export interface PortalAuthRequest extends Request {
  portal?: PortalTokenPayload;
}
