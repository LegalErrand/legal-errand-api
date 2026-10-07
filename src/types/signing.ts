import { Request } from "express";
import { JwtPayload } from "jsonwebtoken";
import { ISignatureRequest } from "../models/firm";

/**
 * Claims carried by a signing link (LE-028).
 *
 * A signer is not a user: they hold no account and no password, so the link is
 * the whole credential. The scope is `"signature"` and never `"firm"` or
 * `"portal"`, so a signing link cannot reach firm or portal routes, and
 * neither of those tokens can reach the signing routes.
 *
 * The token is not sufficient on its own. `authenticateSigner` also requires
 * that `requestId` still names a `pending`, unexpired row whose `tokenId`
 * matches — so a signed, declined or revoked link stops working immediately
 * rather than whenever the JWT happens to expire.
 */
export interface SigningTokenPayload extends JwtPayload {
  requestId: string;
  firmId: string;
  tokenId: string;
  scope: "signature";
}

export interface SigningAuthRequest extends Request {
  signing?: SigningTokenPayload;
  /** The live row, already checked to be pending and unexpired. */
  signatureRequest?: ISignatureRequest;
}
