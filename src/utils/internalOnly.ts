import { Request } from "express";
import { roleOf } from "./tenancy";

/**
 * LE-046, first acceptance criterion: "Interns cannot message clients or send
 * any document outside the firm."
 *
 * Hiding the buttons is not the control — an intern's token is a real firm
 * token, so anything an intern could reach by hand must be refused here. Every
 * route that puts words or documents in front of someone outside the firm calls
 * `blockedFromExternalSend` and stops.
 *
 * The role comes from the verified token, never from the body.
 */
export const INTERNAL_ONLY_ROLES: ReadonlySet<string> = new Set(["intern"]);

/** The only message channel an internal-only role may use. */
export const INTERNAL_CHANNEL = "internal";

export function isInternalOnlyRole(role: string): boolean {
  return INTERNAL_ONLY_ROLES.has(role);
}

/**
 * True when this caller may not send anything outside the firm. Callers that
 * get `true` must refuse with `sendForbidden` and `EXTERNAL_SEND_REFUSAL`.
 */
export function blockedFromExternalSend(req: Request): boolean {
  return isInternalOnlyRole(roleOf(req));
}

export const EXTERNAL_SEND_REFUSAL =
  "Interns cannot send anything outside the firm. Send it to your supervisor, who sends it on.";
