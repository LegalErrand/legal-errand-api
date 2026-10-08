import crypto from "crypto";
import { Types } from "mongoose";
import jwt from "jsonwebtoken";
import { Firm, FirmMember } from "../../models/firm";
import { env } from "../../config/env";

/** The password every fixture member is created with. */
export const PASSWORD = "FixturePassword123!";

export const sha256 = (value: string): string =>
  crypto.createHash("sha256").update(value).digest("hex");

export async function makeFirm(overrides: Record<string, unknown> = {}) {
  return Firm.create({
    name: "Fixture Chambers",
    jurisdiction: "Nigeria (Lagos State High Court)",
    contactEmail: "contact@fixture.ng",
    feeEarnerCapacity: 10,
    ...overrides,
  });
}

/**
 * A member with a usable password.
 *
 * Created through the document so the pre-save hook hashes it — assigning a
 * hash directly would be bcrypted twice and never match.
 */
export async function makeMember(firmId: unknown, overrides: Record<string, unknown> = {}) {
  const fields = {
    firmId,
    name: "Fixture Person",
    email: "person@fixture.ng",
    role: "associate",
    supervision: "standard",
    isActive: true,
    ...overrides,
  } as Record<string, unknown>;

  // initials is required on the model; derive it so callers only pass a name.
  if (!fields.initials) {
    fields.initials =
      String(fields.name)
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .toUpperCase()
        .slice(0, 2) || "FP";
  }

  const member = new FirmMember(fields);
  member.set("password", PASSWORD);
  await member.save();
  return member;
}

/** A firm session token, as /auth/login/verify would issue. */
export const sessionToken = (member: {
  _id: unknown;
  firmId: unknown;
  email: string;
  role: string;
}): string =>
  jwt.sign(
    {
      memberId: String(member._id),
      firmId: String(member.firmId),
      email: member.email,
      role: member.role,
      scope: "firm",
    },
    env.JWT_SECRET,
    { expiresIn: "1h" }
  );

/**
 * Plants a known login code on a member.
 *
 * Login issues and emails its own code, which the test cannot read, so this is
 * called *after* the password step to overwrite it.
 */
export async function plantLoginCode(memberId: Types.ObjectId | string, code = "123456") {
  await FirmMember.updateOne(
    { _id: memberId },
    {
      $set: {
        loginOtpHash: sha256(code),
        loginOtpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        loginOtpAttempts: 0,
      },
    }
  );
  return code;
}
