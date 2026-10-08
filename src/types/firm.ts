import { Request } from "express";
import { JwtPayload } from "jsonwebtoken";

/** Claims carried by a firm-app access token. */
export interface FirmTokenPayload extends JwtPayload {
  memberId: string;
  firmId: string;
  email: string;
  role: string;
  scope: "firm";
  /**
   * Set only on a support session minted against an approved access grant.
   * authenticateFirm refuses anything but a safe method when it is present, so
   * an admin looking into a firm cannot change, send or delete anything.
   */
  readOnly?: true;
  /** The grant the session was minted against, so a revoke can end it. */
  grantId?: string;
}

export interface FirmAuthRequest extends Request {
  member?: FirmTokenPayload;
}
