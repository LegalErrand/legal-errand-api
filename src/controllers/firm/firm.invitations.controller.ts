import crypto from "crypto";
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Firm, FirmInvitation, FirmMember, FirmRole, INVITE_TTL_MS } from "../../models/firm";
import { emailService } from "../../services/email/email.service";
import { env } from "../../config/env";
import { FirmAuthRequest } from "../../types/firm";
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendConflict,
  sendForbidden,
  sendNotFound,
  sendServerError,
} from "../../utils/response";

/**
 * Seniority, highest first. An invitation may only be issued at or below the
 * inviter's own rank, so nobody can promote themselves sideways by inviting a
 * second managing partner and logging in as them.
 */
const RANK: FirmRole[] = [
  "managing_partner",
  "partner",
  "senior_associate",
  "associate",
  "junior_associate",
  "paralegal",
  "admin",
];

/** Admin sits outside the matter ladder: it is a different axis, not a rank. */
const rankOf = (role: FirmRole): number => RANK.indexOf(role);

const sha256 = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");

const isEmail = (value: string): boolean =>
  /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(String(value).trim());

const inviteLink = (token: string): string =>
  `${env.FIRM_APP_URL.replace(/\/$/, "")}/invite/${token}`;

function signFirmToken(memberId: string, firmId: string, email: string, role: string) {
  return jwt.sign({ memberId, firmId, email, role, scope: "firm" }, env.JWT_SECRET, {
    expiresIn: "7d",
  });
}

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "LE";

/**
 * POST /firm/invitations — send one or more invitations.
 *
 * Partial success is normal here: a firm pastes a column of addresses and one
 * of them is already a member. Each entry gets its own result rather than the
 * whole batch failing.
 */
export const sendInvitations = async (req: FirmAuthRequest, res: Response): Promise<void> => {
  try {
    const inviter = req.member;
    if (!inviter) {
      sendForbidden(res, "Not signed in to a firm");
      return;
    }

    const { invites } = req.body as { invites?: Array<{ email?: string; role?: string }> };
    if (!Array.isArray(invites) || invites.length === 0) {
      sendBadRequest(res, "Send at least one invitation");
      return;
    }
    if (invites.length > 50) {
      sendBadRequest(res, "Send at most 50 invitations at a time");
      return;
    }

    const inviterRank = rankOf(inviter.role as FirmRole);
    if (inviterRank < 0) {
      sendForbidden(res, "This role cannot invite people");
      return;
    }

    const firm = await Firm.findById(inviter.firmId);
    if (!firm) {
      sendNotFound(res, "Firm not found");
      return;
    }

    const inviterDoc = await FirmMember.findById(inviter.memberId);
    const inviterName = inviterDoc?.name || "A colleague";

    const results: Array<{ email: string; status: string; reason?: string }> = [];

    for (const entry of invites) {
      const email = String(entry.email ?? "")
        .toLowerCase()
        .trim();
      const role = String(entry.role ?? "associate") as FirmRole;

      if (!isEmail(email)) {
        results.push({ email, status: "rejected", reason: "Not a valid email address" });
        continue;
      }
      if (rankOf(role) < 0) {
        results.push({ email, status: "rejected", reason: "Unknown role" });
        continue;
      }
      // "At or below your own level" — a lower rank is a higher index.
      if (rankOf(role) < inviterRank) {
        results.push({
          email,
          status: "rejected",
          reason: "You cannot invite someone above your own role",
        });
        continue;
      }
      if (await FirmMember.findOne({ email, firmId: firm._id })) {
        results.push({ email, status: "rejected", reason: "Already at this firm" });
        continue;
      }

      // Re-inviting replaces the outstanding invitation rather than stacking a
      // second live token on the same address.
      await FirmInvitation.deleteMany({ firmId: firm._id, email, acceptedAt: { $exists: false } });

      const token = crypto.randomBytes(32).toString("hex");
      await FirmInvitation.create({
        firmId: firm._id,
        email,
        role,
        invitedBy: inviter.memberId,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      });

      await emailService.sendFirmInvitation(email, {
        firmName: firm.name,
        inviterName,
        role,
        link: inviteLink(token),
      });

      results.push({ email, status: "sent" });
    }

    sendCreated(res, { results }, "Invitations processed");
  } catch (error) {
    sendServerError(res, "Could not send the invitations", error);
  }
};

/**
 * GET /firm/invitations/:token — what the landing screen needs.
 *
 * Public, so it returns only what the invitation itself already told the
 * recipient: who invited them, to which firm, at what role. An unknown token
 * and an expired one are distinguished, because "expired" is a screen with a
 * way forward and "unknown" is not.
 */
export const getInvitation = async (req: Request, res: Response): Promise<void> => {
  try {
    const invitation = await FirmInvitation.findOne({
      tokenHash: sha256(String(req.params.token)),
    });
    if (!invitation) {
      sendNotFound(res, "This invitation link is not valid");
      return;
    }

    let status: "pending" | "accepted" | "revoked" | "expired" = "pending";
    if (invitation.acceptedAt) status = "accepted";
    else if (invitation.revokedAt) status = "revoked";
    else if (invitation.expiresAt.getTime() < Date.now()) status = "expired";

    const [firm, inviter] = await Promise.all([
      Firm.findById(invitation.firmId).select("name"),
      FirmMember.findById(invitation.invitedBy).select("name role"),
    ]);

    sendSuccess(
      res,
      {
        status,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        firm: { name: firm?.name ?? "the firm" },
        invitedBy: { name: inviter?.name ?? "A colleague", role: inviter?.role ?? null },
      },
      "Invitation found"
    );
  } catch (error) {
    sendServerError(res, "Could not read the invitation", error);
  }
};

/**
 * POST /firm/invitations/:token/accept — create the member and sign them in.
 *
 * The email is taken from the invitation and never from the request: letting
 * the recipient change it would detach the account from the firm that invited
 * them, which is the one thing this link is supposed to guarantee.
 */
export const acceptInvitation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fullName, password } = req.body as { fullName?: string; password?: string };

    if (!fullName || !String(fullName).trim()) {
      sendBadRequest(res, "Enter your full name");
      return;
    }
    if (!password || String(password).length < 8) {
      sendBadRequest(res, "Choose a password of at least 8 characters");
      return;
    }

    const invitation = await FirmInvitation.findOne({
      tokenHash: sha256(String(req.params.token)),
    });
    if (!invitation) {
      sendNotFound(res, "This invitation link is not valid");
      return;
    }
    if (invitation.acceptedAt || invitation.revokedAt) {
      sendConflict(res, "This invitation has already been used");
      return;
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      sendBadRequest(res, "This invitation has expired");
      return;
    }

    const firm = await Firm.findById(invitation.firmId);
    if (!firm) {
      sendNotFound(res, "That firm no longer exists");
      return;
    }
    // A lawyer can belong to more than one firm — counsel who sits with two
    // chambers, or a consultant. What must not happen twice is a membership of
    // the *same* firm, so the check is scoped to it.
    if (await FirmMember.findOne({ email: invitation.email, firmId: firm._id })) {
      sendConflict(res, "You already have an account at this firm");
      return;
    }

    const name = String(fullName).trim();
    const member = await FirmMember.create({
      firmId: firm._id,
      name,
      email: invitation.email,
      initials: initialsOf(name),
      role: invitation.role,
      supervision: "standard",
      password: String(password),
      // Holding the link is proof enough that the address is theirs.
      emailVerifiedAt: new Date(),
    });

    invitation.acceptedAt = new Date();
    await invitation.save();

    const token = signFirmToken(
      member._id.toString(),
      firm._id.toString(),
      member.email,
      member.role
    );

    sendCreated(res, { token, member: member.toJSON(), firm }, "Welcome to the firm");
  } catch (error) {
    sendServerError(res, "Could not accept the invitation", error);
  }
};
