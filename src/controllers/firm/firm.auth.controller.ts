import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Firm, FirmMember } from "../../models/firm";
import { env } from "../../config/env";
import { FirmAuthRequest } from "../../types/firm";
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendConflict,
  sendNotFound,
  sendServerError,
  sendUnauthorized,
} from "../../utils/response";

function signFirmToken(memberId: string, firmId: string, email: string, role: string) {
  return jwt.sign({ memberId, firmId, email, role, scope: "firm" }, env.JWT_SECRET, {
    expiresIn: "7d",
  });
}

export const onboardFirm = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      firmName,
      jurisdiction,
      contactEmail,
      address,
      aiPreferences,
      adminName,
      adminEmail,
      adminPassword,
    } = req.body;

    if (!firmName || !contactEmail) {
      sendBadRequest(res, "Firm name and contact email are required");
      return;
    }

    if (!adminPassword || String(adminPassword).length < 8) {
      sendBadRequest(res, "An admin password of at least 8 characters is required");
      return;
    }

    const normalisedContact = contactEmail.toLowerCase();
    const adminEmailNormalised = (adminEmail || contactEmail).toLowerCase();

    // Onboarding creates a brand new firm and never authenticates into an
    // existing one. Reusing a firm here would let anyone who knows its contact
    // address mint a managing-partner token for it. Joining an existing firm
    // goes through the invite flow instead.
    const existingFirm = await Firm.findOne({ contactEmail: normalisedContact });
    if (existingFirm) {
      sendConflict(res, "A firm is already registered with that contact email");
      return;
    }

    const existingMember = await FirmMember.findOne({ email: adminEmailNormalised });
    if (existingMember) {
      sendConflict(res, "An account already exists for that email address");
      return;
    }

    const firm = await Firm.create({
      name: firmName,
      jurisdiction: jurisdiction || "Nigeria (Lagos State High Court)",
      contactEmail: normalisedContact,
      address: address || "",
      aiAutonomy: {
        intakeExtraction: aiPreferences?.includes("intake") ? "auto" : "review",
        documentDrafting: aiPreferences?.includes("draft") ? "partner" : "review",
        clientMessaging: "review",
        billingInvoicing: aiPreferences?.includes("billing") ? "partner" : "review",
      },
    });

    const member = await FirmMember.create({
      firmId: firm._id,
      name: adminName || "Managing Partner",
      email: adminEmailNormalised,
      initials: (adminName || "MP")
        .split(" ")
        .map((n: string) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2),
      role: "managing_partner",
      supervision: "standard",
      password: adminPassword,
    });

    const token = signFirmToken(
      member._id.toString(),
      firm._id.toString(),
      member.email,
      member.role
    );

    sendCreated(res, { firm, member, token }, "Firm onboarded successfully");
  } catch (error) {
    sendServerError(res, "Failed to complete firm onboarding", error);
  }
};

export const loginFirmMember = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      sendBadRequest(res, "Email and password are required");
      return;
    }

    const member = await FirmMember.findOne({ email: email.toLowerCase() }).select("+password");

    // Same message for unknown email and wrong password — do not reveal which.
    if (!member || !(await member.comparePassword(password))) {
      sendUnauthorized(res, "Incorrect email or password");
      return;
    }

    if (!member.isActive) {
      sendUnauthorized(res, "This account is no longer active");
      return;
    }

    const firm = await Firm.findById(member.firmId);
    if (!firm) {
      // The member outlived its firm; issuing a firm-scoped token here would
      // produce a session pointing at nothing.
      sendUnauthorized(res, "This account is no longer active");
      return;
    }

    member.lastLogin = new Date();
    await member.save();

    const token = signFirmToken(
      member._id.toString(),
      member.firmId.toString(),
      member.email,
      member.role
    );

    sendSuccess(res, { token, member: member.toJSON(), firm }, "Logged in");
  } catch (error) {
    sendServerError(res, "Login failed", error);
  }
};

export const getCurrentMember = async (req: FirmAuthRequest, res: Response): Promise<void> => {
  try {
    const memberId = req.member?.memberId;
    if (!memberId) {
      sendUnauthorized(res, "Not authenticated");
      return;
    }

    const member = await FirmMember.findById(memberId);
    if (!member) {
      sendNotFound(res, "No active firm member found");
      return;
    }

    // Tokens live for 7 days, so a member deactivated mid-session would keep
    // full access without this check.
    if (!member.isActive) {
      sendUnauthorized(res, "This account is no longer active");
      return;
    }

    const firm = await Firm.findById(member.firmId);
    sendSuccess(res, { member, firm }, "Current member retrieved");
  } catch (error) {
    sendServerError(res, "Failed to retrieve current member", error);
  }
};
