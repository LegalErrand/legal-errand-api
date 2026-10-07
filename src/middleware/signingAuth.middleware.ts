import { Response, NextFunction } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { SignatureRequest, SIGNATURE_LINK_TTL_SECONDS } from "../models/firm";
import { env } from "../config/env";
import { SigningAuthRequest, SigningTokenPayload } from "../types/signing";
import { sendUnauthorized } from "../utils/response";

/** A fresh link id. Stored on the row, so revoking a link is a field write. */
export const newSigningTokenId = (): string => crypto.randomBytes(24).toString("hex");

/**
 * Mints the bearer behind a one-time signing link.
 *
 * The TTL matches the row's `expiresAt`, but the row is what actually decides:
 * see authenticateSigner.
 */
export const signSigningToken = (claims: {
  requestId: string;
  firmId: string;
  tokenId: string;
}): string =>
  jwt.sign(
    { ...claims, scope: "signature" } satisfies Omit<SigningTokenPayload, keyof jwt.JwtPayload>,
    env.JWT_SECRET,
    { expiresIn: SIGNATURE_LINK_TTL_SECONDS }
  );

/**
 * Verifies a signing link and attaches both the claims and the live row.
 *
 * Every signing controller reads `requestId` and `firmId` from these claims and
 * from nowhere else — never from a query string or body — so one signer cannot
 * reach another's document.
 */
export const authenticateSigner = async (
  req: SigningAuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const token = String(req.params.token ?? "");
  if (!token) {
    sendUnauthorized(res, "This signing link is not valid");
    return;
  }

  let claims: SigningTokenPayload;
  try {
    claims = jwt.verify(token, env.JWT_SECRET) as SigningTokenPayload;
  } catch {
    // Deliberately the same message as every other failure below: a signer
    // learns only that the link does not work, never why, so the endpoint
    // cannot be used to probe which requests exist or have been signed.
    sendUnauthorized(res, "This signing link has expired or has already been used");
    return;
  }

  if (claims.scope !== "signature" || !claims.requestId || !claims.tokenId) {
    sendUnauthorized(res, "This signing link has expired or has already been used");
    return;
  }

  const row = await SignatureRequest.findOne({
    _id: claims.requestId,
    firmId: claims.firmId,
    tokenId: claims.tokenId,
    status: "pending",
    expiresAt: { $gt: new Date() },
  });

  if (!row) {
    sendUnauthorized(res, "This signing link has expired or has already been used");
    return;
  }

  req.signing = claims;
  req.signatureRequest = row;
  next();
};
