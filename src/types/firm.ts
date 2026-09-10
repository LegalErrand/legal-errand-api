import { Request } from "express";
import { JwtPayload } from "jsonwebtoken";

/** Claims carried by a firm-app access token. */
export interface FirmTokenPayload extends JwtPayload {
  memberId: string;
  firmId: string;
  email: string;
  role: string;
  scope: "firm";
}

export interface FirmAuthRequest extends Request {
  member?: FirmTokenPayload;
}
