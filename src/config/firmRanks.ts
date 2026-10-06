import { FirmRole } from "../models/firm";

/**
 * Seniority, most senior first. One list, because it was duplicated in the
 * invitations controller and the copy had dropped "intern" — which made
 * inviting an intern fail with "Unknown role", and would have done the same to
 * anyone setting a member's role.
 *
 * Interns sit directly below junior associates: the permission matrix gives
 * them the junior associate column with no client contact, so that is where
 * they rank.
 *
 * Admin is last but is not really a rank — it is a different axis, outside the
 * matter ladder. rankOf still returns a number for it so "at or below your own
 * level" has an answer, and callers that care special-case it.
 */
export const FIRM_RANK: FirmRole[] = [
  "managing_partner",
  "partner",
  "senior_associate",
  "associate",
  "junior_associate",
  "intern",
  "paralegal",
  "admin",
];

/** -1 when the role is not one we know. A lower index is more senior. */
export const rankOf = (role: string): number => FIRM_RANK.indexOf(role as FirmRole);

export const isFirmRole = (role: unknown): role is FirmRole =>
  typeof role === "string" && FIRM_RANK.includes(role as FirmRole);

/** Who may countersign an intern's logbook: associate and above. */
export const canSupervise = (role: string): boolean => {
  const r = rankOf(role);
  return r >= 0 && r <= rankOf("associate");
};
