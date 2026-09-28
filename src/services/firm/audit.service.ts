import { Types } from "mongoose";
import { AdminAuditLog, FirmActivityLog, ActivityType } from "../../models/firm";
import { Admin } from "../../models/Admin";
import { AdminTokenPayload } from "../../types";
import { logger } from "../../utils/logger";

/**
 * The single way an admin action gets on the record.
 *
 * Every endpoint that changes a firm calls this. Nothing else writes to
 * AdminAuditLog, and nothing anywhere updates or deletes from it — the point of
 * the collection is that it cannot be tidied up afterwards.
 *
 * It deliberately never throws. An audit row failing to write must not turn a
 * successful plan change into a 500 for the admin who made it; the failure is
 * logged loudly instead, which is the lesser of the two bad outcomes.
 */
export async function recordAdminAction(input: {
  admin?: AdminTokenPayload;
  action: string;
  firmId?: Types.ObjectId | string;
  firmName?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await AdminAuditLog.create({
      adminId: input.admin?.adminId,
      adminName: await adminNameFor(input.admin),
      action: input.action,
      firmId: input.firmId,
      firmName: input.firmName,
      detail: input.detail,
      at: new Date(),
    });
  } catch (err) {
    logger.logError("Failed to write an admin audit row", err, {
      action: input.action,
      firmId: String(input.firmId ?? ""),
    });
  }
}

/**
 * The name to write on the row. The token carries only an id, an email and a
 * role, so the name is looked up — worth one indexed read on an action that
 * happens a handful of times a day, because "Odebiyi Oladipupo suspended the
 * firm" is a record and "6a1422bf… suspended the firm" is not.
 *
 * Falls back to the email, then to "System" for anything the schedule did on its
 * own. A vague name beats no name.
 */
export async function adminNameFor(admin?: AdminTokenPayload): Promise<string> {
  if (!admin) return "System";
  try {
    const record = await Admin.findById(admin.adminId).select("firstName lastName").lean();
    const name = [record?.firstName, record?.lastName].filter(Boolean).join(" ").trim();
    if (name) return name;
  } catch {
    // Fall through to the email: never fail an action over its audit row.
  }
  return admin.email || "Admin";
}

/**
 * Records something a person at a firm did.
 *
 * `summary` is metadata only — see the boundary note on FirmActivityLog. Pass a
 * reference number rather than a client's name, always.
 */
export async function recordActivity(input: {
  firmId: Types.ObjectId | string;
  memberId: Types.ObjectId | string;
  type: ActivityType;
  summary: string;
  reference?: string;
  city?: string;
  ip?: string;
  suspicious?: boolean;
}): Promise<void> {
  try {
    await FirmActivityLog.create({
      firmId: input.firmId,
      memberId: input.memberId,
      type: input.type,
      summary: input.summary,
      reference: input.reference,
      city: input.city,
      ipPrefix: input.ip ? truncateIp(input.ip) : undefined,
      suspicious: input.suspicious ?? false,
      at: new Date(),
    });
  } catch (err) {
    logger.logError("Failed to write a firm activity row", err, { type: input.type });
  }
}

/**
 * Keeps the first two octets of an IPv4 address and drops the rest, so a run of
 * sign-ins from one network is still recognisable without us holding something
 * that points at a desk. IPv6 keeps its first two groups for the same reason.
 */
export function truncateIp(ip: string): string {
  const cleaned = ip.replace(/^::ffff:/, "").trim();
  if (cleaned.includes(":")) {
    const groups = cleaned.split(":").filter(Boolean);
    return groups.length >= 2 ? `${groups[0]}:${groups[1]}:x:x` : "x:x";
  }
  const octets = cleaned.split(".");
  return octets.length === 4 ? `${octets[0]}.${octets[1]}.x.x` : "x.x.x.x";
}
