import { Request } from "express";
import { FirmAuthRequest } from "../types/firm";

/**
 * The caller's firm, taken from the verified token.
 *
 * Every query against a firm-scoped collection must filter by this. Leaving it
 * out does not fail loudly — it silently returns other firms' rows, which is
 * why these helpers exist rather than reaching into `req.member` by hand at
 * each call site.
 *
 * Throws rather than returning undefined: a missing firmId means the route was
 * mounted without `authenticateFirm`, and failing the request is the only safe
 * response to that.
 */
export function firmIdOf(req: Request): string {
  const firmId = (req as FirmAuthRequest).member?.firmId;
  if (!firmId) {
    throw new Error("No firm on the request — authenticateFirm is not mounted on this route");
  }
  return firmId;
}

/** The caller themselves, for rows that belong to one person rather than the firm. */
export function memberIdOf(req: Request): string {
  const memberId = (req as FirmAuthRequest).member?.memberId;
  if (!memberId) {
    throw new Error("No member on the request — authenticateFirm is not mounted on this route");
  }
  return memberId;
}

/** The caller's role, for server-side checks that must not trust the client. */
export function roleOf(req: Request): string {
  return (req as FirmAuthRequest).member?.role ?? "";
}
