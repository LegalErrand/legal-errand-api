import crypto from "crypto";
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  Firm,
  FirmActivityLog,
  FirmJoinRequest,
  FirmMember,
  FirmSignup,
  FirmInvitation,
  IFirmSignup,
} from "../../models/firm";
import { emailService } from "../../services/email/email.service";
import { env } from "../../config/env";
import { isFirmRole, rankOf } from "../../config/firmRanks";
import { firmIdOf, memberIdOf, roleOf } from "../../utils/tenancy";
import { logger } from "../../utils/logger";
import { FirmAuthRequest } from "../../types/firm";
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendConflict,
  sendNotFound,
  sendServerError,
  sendUnauthorized,
  sendForbidden,
} from "../../utils/response";

function signFirmToken(memberId: string, firmId: string, email: string, role: string) {
  return jwt.sign({ memberId, firmId, email, role, scope: "firm" }, env.JWT_SECRET, {
    expiresIn: "7d",
  });
}

/**
 * The session a verified member gets, however they proved who they are —
 * password plus emailed code, a magic link, or SSO. Exported so the SSO
 * controller issues exactly the same token rather than its own near-copy.
 */
export function signFirmSession(
  member: { _id: unknown; email: string; role: string },
  firm: { _id: unknown }
): string {
  return signFirmToken(String(member._id), String(firm._id), member.email, member.role);
}

/** Whoever may issue an invitation may approve a request for one. */
const JOIN_APPROVER_ROLES = ["managing_partner", "partner", "admin"];

/** An invitation raised by approving a request lasts as long as any other. */
const JOIN_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

/**
 * How long a trusted browser skips the emailed code.
 *
 * Seven days, not the thirty the first draft of this used. Trusting a device
 * means a correct password alone opens a session from that browser, and these
 * are law firms on shared office machines — a month-long window on a reception
 * PC is a month of anyone with the password reading privileged matters. A week
 * removes the daily-login annoyance without leaving that hole open.
 */
const DEVICE_TRUST_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Roles that can never trust a device.
 *
 * These accounts change plans, move money and suspend people. The convenience
 * is not worth the blast radius, so they always get the code — on login and
 * when they ask to trust a device, which is simply refused.
 */
const TRUSTED_DEVICE_ROLES_EXCLUDED = ["managing_partner", "partner"];

const mayTrustDevice = (role: string): boolean => !TRUSTED_DEVICE_ROLES_EXCLUDED.includes(role);

/**
 * 423 with the moment the lock lifts.
 *
 * sendError carries no data field, and the screen needs the time to count
 * down to, so this writes the body directly rather than widening the shared
 * helper for one caller.
 */
function sendLocked(res: Response, message: string, lockedUntil: Date): Response {
  return res.status(423).json({ success: false, message, data: { lockedUntil } });
}

/** Default fee-earner capacity per firm-size band offered on the details step. */
const FEE_EARNERS_BY_SIZE: Record<string, number> = {
  "Sole practitioner": 1,
  "2–5 lawyers": 5,
  "6–20 lawyers": 20,
  "21–50 lawyers": 50,
  "More than 50": 100,
};

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
      domain: normalisedContact.split("@")[1],
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

    // A lawyer may sit at more than one firm, so this is every membership on
    // the address. The first is what the lockout counter and the emailed code
    // hang off; the rest come along once the code is right.
    const candidates = await FirmMember.find({ email: email.toLowerCase() }).select(
      "+password +failedLoginAttempts +lockedUntil +trustedDevices"
    );
    const member = candidates[0];

    // A locked account is told so, and told when it lifts. Hiding the lock
    // behind "incorrect password" just makes someone try the same password
    // fifteen more times and extend their own lockout.
    if (member?.lockedUntil && member.lockedUntil.getTime() > Date.now()) {
      sendLocked(
        res,
        "Too many attempts. This account is locked for a short while.",
        member.lockedUntil
      );
      return;
    }

    // Each membership carries its own password hash, so the ones this password
    // opens are the ones this person may enter. A shared address with different
    // passwords at two firms therefore opens only the one it matches.
    const opened = [];
    for (const c of candidates) {
      if (await c.comparePassword(password)) opened.push(c);
    }

    // Same message for unknown email and wrong password — do not reveal which.
    if (!member || opened.length === 0) {
      if (member) {
        const attempts = (member.failedLoginAttempts ?? 0) + 1;
        const update: Record<string, unknown> = { failedLoginAttempts: attempts };
        if (attempts >= MAX_LOGIN_ATTEMPTS) {
          update.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
          update.failedLoginAttempts = 0;
        }
        await FirmMember.updateOne({ _id: member._id }, { $set: update });

        if (attempts >= MAX_LOGIN_ATTEMPTS) {
          sendLocked(
            res,
            "Too many attempts. This account is locked for a short while.",
            update.lockedUntil as Date
          );
          return;
        }
      }
      sendUnauthorized(res, "Incorrect email or password");
      return;
    }

    if (!member.isActive) {
      sendUnauthorized(res, "This account is no longer active");
      return;
    }

    // The password was right, so the run of failures is over.
    if (member.failedLoginAttempts || member.lockedUntil) {
      await FirmMember.updateOne(
        { _id: member._id },
        { $set: { failedLoginAttempts: 0 }, $unset: { lockedUntil: "" } }
      );
    }

    const firm = await Firm.findById(member.firmId);
    if (!firm) {
      // The member outlived its firm; issuing a firm-scoped token here would
      // produce a session pointing at nothing.
      sendUnauthorized(res, "This account is no longer active");
      return;
    }

    const memberIds = opened.map((m) => String(m._id));

    // A browser the member has already trusted skips the emailed code — and
    // only the code. The password was still required to get here, so this is
    // knowledge plus possession rather than a password on its own.
    //
    // With more than one membership this is deliberately narrow: the skip
    // applies only to the firms where the role is allowed to trust a device.
    // Somebody who is an associate at one firm and a partner at another gets
    // straight into the first and is still asked for a code for the second,
    // rather than one firm's convenience lowering the bar at the other.
    const { deviceToken } = req.body as { deviceToken?: string };
    if (deviceToken) {
      const hash = sha256(String(deviceToken));
      const now = Date.now();
      const eligible = opened.filter(
        (m) =>
          mayTrustDevice(m.role) &&
          (m.trustedDevices ?? []).some((d) => d.tokenHash === hash && d.expiresAt.getTime() > now)
      );

      if (eligible.length > 0) {
        // Recorded so the member can tell which machine is which when they
        // come to revoke one.
        await FirmMember.updateMany(
          { _id: { $in: eligible.map((m) => m._id) }, "trustedDevices.tokenHash": hash },
          { $set: { "trustedDevices.$.lastUsedAt": new Date() } }
        );

        if (eligible.length === 1) {
          const session = await issueSessionFor(String(eligible[0]._id));
          if (!session) {
            sendUnauthorized(res, "This account is no longer active");
            return;
          }
          sendSuccess(res, session, "Logged in");
          return;
        }

        sendSuccess(
          res,
          {
            needsFirmChoice: true,
            choiceToken: signFirmChoiceToken(
              eligible.map((m) => String(m._id)),
              member.email
            ),
            firms: await describeMemberships(eligible.map((m) => String(m._id))),
          },
          "Choose a firm"
        );
        return;
      }
    }

    // Correct credentials are only half of a login. The session token is issued
    // by /auth/login/verify once the emailed code comes back, so a stolen
    // password on its own does not reach the firm's matters.
    const code = generateCode();
    await FirmMember.updateOne(
      { _id: member._id },
      {
        $set: {
          loginOtpHash: sha256(code),
          loginOtpExpiresAt: new Date(Date.now() + CODE_TTL_MS),
          loginOtpAttempts: 0,
          loginOtpSentAt: new Date(),
        },
      }
    );
    await emailService.sendFirmLoginOtp(member.email, code);
    devRevealCode("login code", member.email, code);

    sendSuccess(
      res,
      {
        challengeToken: signLoginChallengeToken(memberIds, String(member._id), member.email),
        email: maskEmail(member.email),
        // So the code screen can hide "trust this browser" from roles that are
        // not allowed it, rather than offering a tick that is silently refused.
        mayTrustDevice: mayTrustDevice(member.role),
      },
      "Enter the code we emailed you"
    );
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

/* ───────────────────────────────────────────────────────────────────────────
 * Sign-up flow
 *
 * The firm sign-up is three screens: email + password, a six-digit code, then
 * the firm's details. No Firm or FirmMember exists until the last step, so the
 * first two write to FirmSignup instead. The step between them is carried by a
 * short-lived onboarding token rather than a session, so a half-finished
 * sign-up can never reach firm data.
 * ─────────────────────────────────────────────────────────────────────────── */

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const RESET_TTL_MS = 60 * 60 * 1000;

const sha256 = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");

/** Six digits, uniformly distributed — Math.random is not used for secrets. */
const generateCode = (): string => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

/**
 * Prints a one-time code to the server log so a developer can finish a login
 * locally without an inbox.
 *
 * Gated on NODE_ENV === "development" exactly, not on `!== "production"`, so a
 * staging deployment never prints one. The code is still hashed and emailed
 * normally — this only mirrors it to the console.
 */
const devRevealCode = (label: string, recipient: string, code: string): void => {
  if (env.NODE_ENV !== "development") return;
  logger.warn(
    `[dev] ${label} for ${recipient}: ${code} — development only, never printed elsewhere`
  );
};

const isEmail = (value: string): boolean => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(value.trim());

function signOnboardingToken(signupId: string, email: string): string {
  // Deliberately not scope "firm": this token proves an email was verified and
  // nothing more. authenticateFirm rejects it.
  return jwt.sign({ signupId, email, scope: "firm-onboarding" }, env.JWT_SECRET, {
    expiresIn: "1h",
  });
}

function readOnboardingToken(req: Request): { signupId: string; email: string } | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const decoded = jwt.verify(header.split(" ")[1], env.JWT_SECRET) as {
      signupId?: string;
      email?: string;
      scope?: string;
    };
    if (decoded.scope !== "firm-onboarding" || !decoded.signupId || !decoded.email) return null;
    return { signupId: decoded.signupId, email: decoded.email };
  } catch {
    return null;
  }
}

/**
 * Proves a password was accepted, and nothing more. Not scope "firm", so
 * authenticateFirm rejects it and it cannot reach firm data on its own.
 */
function signLoginChallengeToken(memberIds: string[], otpMemberId: string, email: string): string {
  return jwt.sign({ memberIds, otpMemberId, email, scope: "firm-login-otp" }, env.JWT_SECRET, {
    expiresIn: "10m",
  });
}

/**
 * Issued once the code is right, to carry the choice of firm and nothing else.
 *
 * Not scope "firm", so authenticateFirm refuses it: holding one proves the
 * password and the code were both accepted, and buys only the right to name
 * which of those memberships to enter.
 */
function signFirmChoiceToken(memberIds: string[], email: string): string {
  return jwt.sign({ memberIds, email, scope: "firm-login-choice" }, env.JWT_SECRET, {
    expiresIn: "10m",
  });
}

/** The firms a set of memberships belongs to, for the "choose a firm" screen. */
async function describeMemberships(memberIds: string[]) {
  const members = await FirmMember.find({ _id: { $in: memberIds } }).select("firmId role name");
  const firms = await Firm.find({ _id: { $in: members.map((m) => m.firmId) } }).select("name");
  const byId = new Map(firms.map((f) => [String(f._id), f.name]));
  return members.map((m) => ({
    memberId: String(m._id),
    firmId: String(m.firmId),
    firmName: byId.get(String(m.firmId)) ?? "A firm",
    role: m.role,
  }));
}

/** Issues the session for one chosen membership. */
async function issueSessionFor(memberId: string) {
  const member = await FirmMember.findById(memberId);
  if (!member || !member.isActive) return null;
  const firm = await Firm.findById(member.firmId);
  if (!firm) return null;
  await FirmMember.updateOne({ _id: member._id }, { $set: { lastLogin: new Date() } });
  return { token: signFirmSession(member, firm), member: member.toJSON(), firm };
}

function readScopedToken(
  req: Request,
  scope: "firm-login-otp" | "firm-login-choice"
): { memberIds: string[]; otpMemberId?: string; email: string } | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const decoded = jwt.verify(header.split(" ")[1], env.JWT_SECRET) as {
      memberIds?: string[];
      otpMemberId?: string;
      email?: string;
      scope?: string;
    };
    if (decoded.scope !== scope || !decoded.memberIds?.length || !decoded.email) return null;
    return { memberIds: decoded.memberIds, otpMemberId: decoded.otpMemberId, email: decoded.email };
  } catch {
    return null;
  }
}

/** "a****a@firm.com" — enough to recognise the inbox, not enough to harvest it. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const shown =
    local.length <= 2
      ? local[0]
      : `${local[0]}${"*".repeat(Math.min(local.length - 2, 6))}${local[local.length - 1]}`;
  return `${shown}@${domain}`;
}

async function issueSignupCode(signup: IFirmSignup): Promise<string> {
  const code = generateCode();
  signup.codeHash = sha256(code);
  signup.codeExpiresAt = new Date(Date.now() + CODE_TTL_MS);
  signup.codeAttempts = 0;
  signup.lastCodeSentAt = new Date();
  await signup.save();
  devRevealCode("signup code", signup.email, code);
  return code;
}

/** POST /firm/auth/signup — email + password, then email a six-digit code. */
export const startFirmSignup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !isEmail(email)) {
      sendBadRequest(res, "Enter a valid work email address");
      return;
    }
    if (!password || String(password).length < 8) {
      sendBadRequest(res, "Choose a password of at least 8 characters");
      return;
    }

    const normalised = email.toLowerCase().trim();

    // A finished account is a conflict; an unfinished sign-up is not, or a
    // mistyped password on the first screen would lock the address out.
    if (await FirmMember.findOne({ email: normalised })) {
      sendConflict(res, "An account already exists for that email address");
      return;
    }

    const hashed = await bcrypt.hash(String(password), Number(env.BCRYPT_SALT_ROUNDS));
    let signup = await FirmSignup.findOne({ email: normalised }).select("+password +codeHash");

    if (signup) {
      signup.password = hashed;
      signup.verifiedAt = undefined;
      signup.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    } else {
      signup = new FirmSignup({ email: normalised, password: hashed });
    }

    const code = await issueSignupCode(signup);
    await emailService.sendVerificationOtp(normalised, code);

    sendCreated(res, { email: normalised }, "Verification code sent");
  } catch (error) {
    sendServerError(res, "Could not start sign-up", error);
  }
};

/** POST /firm/auth/signup/resend — a new code, behind a 60s cooldown. */
export const resendSignupCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body as { email?: string };
    if (!email) {
      sendBadRequest(res, "Email is required");
      return;
    }

    const signup = await FirmSignup.findOne({ email: email.toLowerCase().trim() }).select(
      "+codeHash"
    );
    // Same response either way — this endpoint must not reveal who is mid-signup.
    if (!signup || signup.verifiedAt) {
      sendSuccess(
        res,
        { retryAfterSeconds: 0 },
        "If that sign-up is in progress, a code is on its way"
      );
      return;
    }

    const since = Date.now() - (signup.lastCodeSentAt?.getTime() ?? 0);
    if (since < RESEND_COOLDOWN_MS) {
      sendSuccess(
        res,
        { retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - since) / 1000) },
        "A code was sent recently"
      );
      return;
    }

    const code = await issueSignupCode(signup);
    await emailService.sendVerificationOtp(signup.email, code);

    sendSuccess(res, { retryAfterSeconds: 60 }, "Verification code sent");
  } catch (error) {
    sendServerError(res, "Could not resend the code", error);
  }
};

/** POST /firm/auth/signup/verify — exchange the code for an onboarding token. */
export const verifySignupEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, code } = req.body as { email?: string; code?: string };
    if (!email || !code) {
      sendBadRequest(res, "Email and code are required");
      return;
    }

    const signup = await FirmSignup.findOne({ email: email.toLowerCase().trim() }).select(
      "+codeHash"
    );
    if (!signup) {
      sendBadRequest(res, "That code is not valid");
      return;
    }

    if (signup.verifiedAt) {
      sendSuccess(
        res,
        { onboardingToken: signOnboardingToken(signup._id.toString(), signup.email) },
        "Email already verified"
      );
      return;
    }

    if (signup.codeAttempts >= MAX_CODE_ATTEMPTS) {
      sendBadRequest(res, "Too many incorrect codes. Request a new one.");
      return;
    }
    if (!signup.codeHash || !signup.codeExpiresAt || signup.codeExpiresAt.getTime() < Date.now()) {
      sendBadRequest(res, "That code has expired. Request a new one.");
      return;
    }
    if (signup.codeHash !== sha256(String(code).trim())) {
      signup.codeAttempts += 1;
      await signup.save();
      sendBadRequest(res, "That code is not valid");
      return;
    }

    signup.verifiedAt = new Date();
    signup.codeHash = undefined;
    signup.codeExpiresAt = undefined;
    signup.codeAttempts = 0;
    await signup.save();

    sendSuccess(
      res,
      { onboardingToken: signOnboardingToken(signup._id.toString(), signup.email) },
      "Email verified"
    );
  } catch (error) {
    sendServerError(res, "Could not verify the code", error);
  }
};

/**
 * POST /firm/auth/signup/firm — the last step: create the Firm and its first
 * member, and hand back a real session token.
 */
export const completeFirmSetup = async (req: Request, res: Response): Promise<void> => {
  try {
    const claims = readOnboardingToken(req);
    if (!claims) {
      sendUnauthorized(res, "Verify your email address again to continue");
      return;
    }

    const { firmName, jurisdiction, size, registrationNumber, role, fullName, address } =
      req.body as {
        firmName?: string;
        jurisdiction?: string;
        size?: string;
        registrationNumber?: string;
        role?: string;
        fullName?: string;
        address?: string;
      };

    if (!firmName || !String(firmName).trim()) {
      sendBadRequest(res, "Firm name is required");
      return;
    }

    const signup = await FirmSignup.findById(claims.signupId).select("+password");
    if (!signup || !signup.verifiedAt) {
      sendUnauthorized(res, "Verify your email address again to continue");
      return;
    }

    // Re-check here as well as in startFirmSignup: minutes have passed, and an
    // invite could have created this member in the meantime.
    if (await FirmMember.findOne({ email: signup.email })) {
      sendConflict(res, "An account already exists for that email address");
      return;
    }

    const firm = await Firm.create({
      name: String(firmName).trim(),
      jurisdiction: jurisdiction || "Nigeria (Lagos State High Court)",
      contactEmail: signup.email,
      // Recorded so the next colleague on this domain is offered the firm
      // rather than quietly creating a second one beside it.
      domain: signup.email.split("@")[1],
      registrationNumber: registrationNumber ? String(registrationNumber).trim() : undefined,
      address: address ? String(address).trim() : undefined,
      feeEarnerCapacity: FEE_EARNERS_BY_SIZE[String(size ?? "")] ?? 10,
    });

    const name = String(fullName ?? "").trim() || signup.email.split("@")[0];
    const member = await FirmMember.create({
      firmId: firm._id,
      name,
      email: signup.email,
      initials:
        name
          .split(/\s+/)
          .map((part: string) => part[0])
          .join("")
          .toUpperCase()
          .slice(0, 2) || "MP",
      // Whoever creates the firm holds the highest access; "Partner" is the
      // only other option the form offers.
      role: role === "Partner" ? "partner" : "managing_partner",
      supervision: "standard",
      emailVerifiedAt: signup.verifiedAt,
    });

    // The password was hashed when the sign-up started, so it is written with
    // updateOne: the pre-save hook hashes anything assigned through the
    // document, which would bcrypt the hash a second time and lock the account.
    await FirmMember.updateOne({ _id: member._id }, { $set: { password: signup.password } });

    await FirmSignup.deleteOne({ _id: signup._id });

    const token = signFirmToken(
      member._id.toString(),
      firm._id.toString(),
      member.email,
      member.role
    );

    sendCreated(res, { firm, member: member.toJSON(), token }, "Firm created");
  } catch (error) {
    sendServerError(res, "Could not create the firm", error);
  }
};

/* ───────────────────────────────────────────────────────────────────────────
 * Password recovery
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * POST /firm/auth/forgot-password
 *
 * Always answers the same way. "No such account" is how someone enumerates the
 * real lawyers at a firm, so the response never distinguishes the two cases.
 */
export const requestPasswordReset = async (req: Request, res: Response): Promise<void> => {
  const generic = "If an account exists for that address, a reset link is on its way";
  try {
    const { email } = req.body as { email?: string };
    if (!email || !isEmail(email)) {
      sendBadRequest(res, "Enter a valid email address");
      return;
    }

    const member = await FirmMember.findOne({ email: email.toLowerCase().trim() });
    if (member && member.isActive) {
      const token = crypto.randomBytes(32).toString("hex");
      member.passwordResetTokenHash = sha256(token);
      member.passwordResetExpiresAt = new Date(Date.now() + RESET_TTL_MS);
      await member.save();

      const link = `${env.FIRM_APP_URL.replace(/\/$/, "")}/reset-password?token=${token}`;
      await emailService.sendFirmPasswordResetLink(member.email, link);
    }

    sendSuccess(res, {}, generic);
  } catch (error) {
    sendServerError(res, "Could not start the password reset", error);
  }
};

/** POST /firm/auth/reset-password — spend the token, set the password. */
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, password } = req.body as { token?: string; password?: string };

    if (!token) {
      sendBadRequest(res, "This reset link is no longer valid");
      return;
    }
    if (!password || String(password).length < 8) {
      sendBadRequest(res, "Choose a password of at least 8 characters");
      return;
    }

    const member = await FirmMember.findOne({
      passwordResetTokenHash: sha256(String(token)),
      passwordResetExpiresAt: { $gt: new Date() },
    }).select("+password +passwordResetTokenHash +passwordResetExpiresAt");

    if (!member || !member.isActive) {
      sendBadRequest(res, "This reset link has expired or has already been used");
      return;
    }

    member.password = String(password);
    // Single use, and every token issued before now stops working.
    member.passwordResetTokenHash = undefined;
    member.passwordResetExpiresAt = undefined;
    member.passwordChangedAt = new Date();
    await member.save();

    sendSuccess(res, {}, "Password changed");
  } catch (error) {
    sendServerError(res, "Could not change the password", error);
  }
};

/* ───────────────────────────────────────────────────────────────────────────
 * Login one-time code
 * ─────────────────────────────────────────────────────────────────────────── */

/** POST /firm/auth/login/verify — exchange the emailed code for a session. */
export const verifyLoginOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const claims = readScopedToken(req, "firm-login-otp");
    if (!claims?.otpMemberId) {
      sendUnauthorized(res, "That sign-in attempt has expired. Log in again.");
      return;
    }

    const { code } = req.body as { code?: string };
    if (!code) {
      sendBadRequest(res, "Enter the six-digit code");
      return;
    }

    const member = await FirmMember.findById(claims.otpMemberId).select(
      "+loginOtpHash +loginOtpExpiresAt +loginOtpAttempts"
    );
    if (!member || !member.isActive) {
      sendUnauthorized(res, "This account is no longer active");
      return;
    }

    if ((member.loginOtpAttempts ?? 0) >= MAX_CODE_ATTEMPTS) {
      sendBadRequest(res, "Too many incorrect codes. Log in again to get a new one.");
      return;
    }
    if (
      !member.loginOtpHash ||
      !member.loginOtpExpiresAt ||
      member.loginOtpExpiresAt.getTime() < Date.now()
    ) {
      sendBadRequest(res, "That code has expired. Log in again to get a new one.");
      return;
    }
    if (member.loginOtpHash !== sha256(String(code).trim())) {
      await FirmMember.updateOne({ _id: member._id }, { $inc: { loginOtpAttempts: 1 } });
      sendBadRequest(res, "That code is not valid");
      return;
    }

    const firm = await Firm.findById(member.firmId);
    if (!firm) {
      sendUnauthorized(res, "This account is no longer active");
      return;
    }

    // Single use: the code dies with the session it produced.
    await FirmMember.updateOne(
      { _id: member._id },
      {
        $set: { lastLogin: new Date() },
        $unset: {
          loginOtpHash: "",
          loginOtpExpiresAt: "",
          loginOtpAttempts: "",
          loginOtpSentAt: "",
        },
      }
    );

    // "Trust this browser", if it was asked for. One token covers every
    // membership allowed to honour it, so a second firm on the same browser is
    // not asked again — but a membership whose role is excluded never records
    // it, and so still gets the code.
    const { trustDevice, deviceLabel } = req.body as {
      trustDevice?: boolean;
      deviceLabel?: string;
    };
    const trustable = await FirmMember.find({ _id: { $in: claims.memberIds } }).select("role");
    const trustableIds = trustable.filter((m) => mayTrustDevice(m.role)).map((m) => m._id);

    let issuedDeviceToken: string | undefined;
    if (trustDevice === true && trustableIds.length > 0) {
      issuedDeviceToken = crypto.randomBytes(32).toString("hex");
      await FirmMember.updateMany(
        { _id: { $in: trustableIds } },
        {
          $push: {
            trustedDevices: {
              id: crypto.randomBytes(8).toString("hex"),
              tokenHash: sha256(issuedDeviceToken),
              label:
                String(deviceLabel ?? "")
                  .trim()
                  .slice(0, 80) || undefined,
              expiresAt: new Date(Date.now() + DEVICE_TRUST_MS),
              createdAt: new Date(),
            },
          },
        }
      );
    }

    const common = {
      deviceToken: issuedDeviceToken,
      // Said plainly so the screen can explain why the tick did nothing,
      // rather than silently ignoring a partner who asked to be remembered.
      deviceTrustRefused: trustDevice === true && trustableIds.length === 0,
      deviceTrustDays: issuedDeviceToken ? DEVICE_TRUST_MS / 86_400_000 : undefined,
    };

    // More than one firm answered to that password, so the person picks. No
    // session is issued here: the choice token carries only the right to name
    // one of these memberships, and chooseLoginFirm checks it is one of them.
    if (claims.memberIds.length > 1) {
      sendSuccess(
        res,
        {
          ...common,
          needsFirmChoice: true,
          choiceToken: signFirmChoiceToken(claims.memberIds, member.email),
          firms: await describeMemberships(claims.memberIds),
        },
        "Choose a firm"
      );
      return;
    }

    const session = await issueSessionFor(claims.memberIds[0]);
    if (!session) {
      sendUnauthorized(res, "This account is no longer active");
      return;
    }

    sendSuccess(res, { ...session, ...common }, "Logged in");
  } catch (error) {
    sendServerError(res, "Could not verify the code", error);
  }
};

/** POST /firm/auth/login/resend — a fresh login code, behind the same cooldown. */
export const resendLoginOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const claims = readScopedToken(req, "firm-login-otp");
    if (!claims?.otpMemberId) {
      sendUnauthorized(res, "That sign-in attempt has expired. Log in again.");
      return;
    }

    const member = await FirmMember.findById(claims.otpMemberId).select("+loginOtpSentAt");
    if (!member || !member.isActive) {
      sendUnauthorized(res, "This account is no longer active");
      return;
    }

    const since = Date.now() - (member.loginOtpSentAt?.getTime() ?? 0);
    if (since < RESEND_COOLDOWN_MS) {
      sendSuccess(
        res,
        { retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - since) / 1000) },
        "A code was sent recently"
      );
      return;
    }

    const code = generateCode();
    await FirmMember.updateOne(
      { _id: member._id },
      {
        $set: {
          loginOtpHash: sha256(code),
          loginOtpExpiresAt: new Date(Date.now() + CODE_TTL_MS),
          loginOtpAttempts: 0,
          loginOtpSentAt: new Date(),
        },
      }
    );
    await emailService.sendFirmLoginOtp(member.email, code);
    devRevealCode("login code", member.email, code);

    sendSuccess(res, { retryAfterSeconds: 60 }, "Verification code sent");
  } catch (error) {
    sendServerError(res, "Could not resend the code", error);
  }
};

/* ───────────────────────────────────────────────────────────────────────────
 * Bar verification
 *
 * This is about what may leave the firm with someone's name on it — signing a
 * filing, advising a client, approving what the AI drafted — and never about
 * whether they can sign in. An unverified lawyer still gets in and can still
 * set the firm up; the gate sits in front of the outputs, not the door.
 * ─────────────────────────────────────────────────────────────────────────── */

const NON_LAWYER_ROLES = ["paralegal", "admin"];

/** POST /firm/auth/bar — submit details, skip for now, or say you are not a lawyer. */
export const submitBarVerification = async (req: FirmAuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.member) {
      sendUnauthorized(res, "Not signed in to a firm");
      return;
    }

    const { action, barNumber, yearOfCall, jurisdiction, certificateUrl } = req.body as {
      action?: "submit" | "skip" | "not_a_lawyer";
      barNumber?: string;
      yearOfCall?: number | string;
      jurisdiction?: string;
      certificateUrl?: string;
    };

    const member = await FirmMember.findById(req.member.memberId);
    if (!member) {
      sendNotFound(res, "Member not found");
      return;
    }

    if (action === "skip") {
      member.barStatus = "skipped";
      await member.save();
      sendSuccess(res, { barStatus: member.barStatus }, "You can finish this from Settings later");
      return;
    }

    if (action === "not_a_lawyer") {
      member.barStatus = "not_applicable";
      await member.save();
      sendSuccess(res, { barStatus: member.barStatus }, "Noted — we will not ask again");
      return;
    }

    if (!barNumber || !String(barNumber).trim()) {
      sendBadRequest(res, "Enter your bar number");
      return;
    }

    const year = Number(yearOfCall);
    const thisYear = new Date().getFullYear();
    if (!Number.isInteger(year) || year < 1900 || year > thisYear) {
      sendBadRequest(res, `Enter a year of call between 1900 and ${thisYear}`);
      return;
    }

    member.barNumber = String(barNumber).trim();
    member.barYearOfCall = year;
    member.barJurisdiction = jurisdiction ? String(jurisdiction).trim() : undefined;
    // The certificate is optional: a number and a year are enough to start the
    // check, and chasing a photograph here loses people mid-signup.
    member.barCertificateUrl = certificateUrl ? String(certificateUrl).trim() : undefined;
    // "pending", not "verified" — nothing here proves anything on its own. The
    // check against the bar body happens out of band.
    member.barStatus = "pending";
    member.barSubmittedAt = new Date();
    await member.save();

    sendSuccess(res, { barStatus: member.barStatus }, "Submitted for verification");
  } catch (error) {
    sendServerError(res, "Could not submit your bar details", error);
  }
};

/** GET /firm/auth/bar — where the check has got to, and whether it is even asked. */
export const getBarVerification = async (req: FirmAuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.member) {
      sendUnauthorized(res, "Not signed in to a firm");
      return;
    }
    const member = await FirmMember.findById(req.member.memberId);
    if (!member) {
      sendNotFound(res, "Member not found");
      return;
    }
    sendSuccess(
      res,
      {
        barStatus: member.barStatus,
        barNumber: member.barNumber ?? null,
        barYearOfCall: member.barYearOfCall ?? null,
        barJurisdiction: member.barJurisdiction ?? null,
        submittedAt: member.barSubmittedAt ?? null,
        // Paralegals and admin staff are never asked for this.
        required: !NON_LAWYER_ROLES.includes(member.role),
      },
      "Bar verification status"
    );
  } catch (error) {
    sendServerError(res, "Could not read your bar status", error);
  }
};

/* ───────────────────────────────────────────────────────────────────────────
 * Passwordless sign-in
 *
 * A link emailed to the address on the account. Holding it proves the inbox,
 * which is the same thing the one-time code proves, so it stands in for both
 * the password and the code rather than being a shortcut past them.
 * ─────────────────────────────────────────────────────────────────────────── */

/** POST /firm/auth/magic-link — always answers the same way. */
export const requestMagicLink = async (req: Request, res: Response): Promise<void> => {
  const generic = "If an account exists for that address, a sign-in link is on its way";
  try {
    const { email } = req.body as { email?: string };
    if (!email || !isEmail(email)) {
      sendBadRequest(res, "Enter a valid email address");
      return;
    }

    const member = await FirmMember.findOne({ email: email.toLowerCase().trim() }).select(
      "+lockedUntil"
    );

    // A locked account does not get a link either: it would be a way round the
    // lockout, which is the one thing the lockout exists to prevent.
    const locked = member?.lockedUntil && member.lockedUntil.getTime() > Date.now();

    if (member && member.isActive && !locked) {
      const token = crypto.randomBytes(32).toString("hex");
      await FirmMember.updateOne(
        { _id: member._id },
        {
          $set: {
            magicLinkTokenHash: sha256(token),
            magicLinkExpiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
          },
        }
      );
      const link = `${env.FIRM_APP_URL.replace(/\/$/, "")}/magic-link?token=${token}`;
      await emailService.sendFirmMagicLink(member.email, link);
    }

    sendSuccess(res, {}, generic);
  } catch (error) {
    sendServerError(res, "Could not send a sign-in link", error);
  }
};

/** POST /firm/auth/magic-link/verify — spend the link, hand back a session. */
export const verifyMagicLink = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.body as { token?: string };
    if (!token) {
      sendBadRequest(res, "This sign-in link is no longer valid");
      return;
    }

    const member = await FirmMember.findOne({
      magicLinkTokenHash: sha256(String(token)),
      magicLinkExpiresAt: { $gt: new Date() },
    }).select("+magicLinkTokenHash +magicLinkExpiresAt");

    if (!member || !member.isActive) {
      sendBadRequest(res, "This sign-in link has expired or has already been used");
      return;
    }

    const firm = await Firm.findById(member.firmId);
    if (!firm) {
      sendUnauthorized(res, "This account is no longer active");
      return;
    }

    // Single use, and it clears any lockout: whoever holds the link controls
    // the inbox, which is stronger evidence than the password that failed.
    await FirmMember.updateOne(
      { _id: member._id },
      {
        $set: { lastLogin: new Date(), failedLoginAttempts: 0 },
        $unset: { magicLinkTokenHash: "", magicLinkExpiresAt: "", lockedUntil: "" },
      }
    );

    const authToken = signFirmToken(
      member._id.toString(),
      member.firmId.toString(),
      member.email,
      member.role
    );

    sendSuccess(res, { token: authToken, member: member.toJSON(), firm }, "Logged in");
  } catch (error) {
    sendServerError(res, "Could not sign you in with that link", error);
  }
};

/**
 * GET /firm/auth/me/activity — this person's own recent activity (LE-006).
 *
 * Scoped to the caller by memberId as well as firmId: an activity log is a
 * security record, and nobody reads anybody else's from here. Carries the
 * city and IP prefix already recorded, so an unfamiliar sign-in is visible
 * to the person it happened to.
 */
export const getMyActivity = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const memberId = memberIdOf(req);

    const rows = await FirmActivityLog.find({ firmId, memberId }).sort({ at: -1 }).limit(30).lean();

    sendSuccess(
      res,
      rows.map((r) => ({
        id: String(r._id),
        type: r.type,
        summary: r.summary,
        reference: r.reference,
        city: r.city,
        ipPrefix: r.ipPrefix,
        suspicious: Boolean(r.suspicious),
        at: r.at,
      })),
      "Activity retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve your activity", error);
  }
};

// ─── Trusted devices ─────────────────────────────────────────────────────────

/**
 * GET /firm/auth/devices — the browsers this member has trusted.
 *
 * Scoped to the caller's own account and nobody else's: the id comes from the
 * session token, never from a parameter. Token hashes are never returned —
 * there is nothing a client can do with one, and sending it would put a login
 * credential's hash on the wire for no reason.
 */
export const listTrustedDevices = async (req: FirmAuthRequest, res: Response): Promise<void> => {
  try {
    const member = await FirmMember.findById(memberIdOf(req)).select("+trustedDevices role");
    if (!member) {
      sendNotFound(res, "Account not found");
      return;
    }

    const now = Date.now();
    const devices = (member.trustedDevices ?? [])
      .filter((d) => d.expiresAt.getTime() > now)
      .map((d) => ({
        id: d.id,
        label: d.label ?? "Unnamed browser",
        trustedOn: d.createdAt.toISOString(),
        lastUsedAt: d.lastUsedAt?.toISOString() ?? null,
        expiresAt: d.expiresAt.toISOString(),
      }))
      .sort((a, b) => b.trustedOn.localeCompare(a.trustedOn));

    sendSuccess(
      res,
      {
        devices,
        /** False for partners, so the screen can say why the option is absent. */
        mayTrustDevices: mayTrustDevice(member.role),
        trustDays: DEVICE_TRUST_MS / 86_400_000,
      },
      "Trusted devices retrieved"
    );
  } catch (error) {
    sendServerError(res, "Could not list trusted devices", error);
  }
};

/**
 * DELETE /firm/auth/devices/:id — stop trusting one browser.
 *
 * The next login from it needs the emailed code again. A firm that loses
 * control of a machine can cut it off here without changing anyone's password.
 */
export const revokeTrustedDevice = async (req: FirmAuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id ?? "");
    if (!id) {
      sendBadRequest(res, "Which device?");
      return;
    }

    const result = await FirmMember.updateOne(
      { _id: memberIdOf(req) },
      { $pull: { trustedDevices: { id } } }
    );

    if (result.modifiedCount === 0) {
      sendNotFound(res, "That device is not on your list");
      return;
    }

    sendSuccess(res, { id }, "That browser will need the code next time");
  } catch (error) {
    sendServerError(res, "Could not revoke the device", error);
  }
};

/**
 * DELETE /firm/auth/devices — stop trusting all of them at once.
 *
 * The button someone reaches for after losing a laptop, so it is deliberately
 * one call rather than a loop over the list.
 */
export const revokeAllTrustedDevices = async (
  req: FirmAuthRequest,
  res: Response
): Promise<void> => {
  try {
    await FirmMember.updateOne({ _id: memberIdOf(req) }, { $set: { trustedDevices: [] } });
    sendSuccess(res, {}, "Every browser will need the code next time");
  } catch (error) {
    sendServerError(res, "Could not revoke the devices", error);
  }
};

/**
 * POST /firm/auth/login/firm — pick which firm to enter.
 *
 * Only reachable with a choice token, which is only minted once the password
 * and the code have both been accepted. The chosen membership has to be one of
 * the set that token was minted for, so this cannot be used to enter a firm the
 * password never opened — the id in the body is checked against the claims, not
 * trusted on its own.
 */
export const chooseLoginFirm = async (req: Request, res: Response): Promise<void> => {
  try {
    const claims = readScopedToken(req, "firm-login-choice");
    if (!claims) {
      sendUnauthorized(res, "That sign-in attempt has expired. Log in again.");
      return;
    }

    const { memberId } = req.body as { memberId?: string };
    if (!memberId) {
      sendBadRequest(res, "Choose a firm");
      return;
    }

    if (!claims.memberIds.includes(memberId)) {
      sendForbidden(res, "That firm was not one of yours to choose");
      return;
    }

    const session = await issueSessionFor(memberId);
    if (!session) {
      sendUnauthorized(res, "This account is no longer active");
      return;
    }

    sendSuccess(res, session, "Logged in");
  } catch (error) {
    sendServerError(res, "Could not open that firm", error);
  }
};

/* ───────────────────────────────────────────────────────────────────────────
 * Joining a firm that already exists
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * Mailboxes anyone can register, so matching on them would offer to put every
 * gmail signup into whichever firm happened to register on gmail first.
 */
const PUBLIC_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "live.com",
  "aol.com",
];

const domainOf = (email: string): string | null => {
  const d = String(email).toLowerCase().trim().split("@")[1];
  return !d || PUBLIC_EMAIL_DOMAINS.includes(d) ? null : d;
};

/**
 * GET /firm/auth/firm-by-domain?email= — is a colleague's firm already here?
 *
 * Public, and it does confirm that a firm exists on a domain. That is a
 * deliberate trade: without it the second person at a firm silently creates a
 * duplicate, and the practice ends up split across two accounts that cannot
 * see each other's matters — far harder to undo than a request in a queue.
 *
 * It returns only the firm's name and headcount, which is not news to anyone
 * who works there, and free mailboxes are excluded so this cannot be used to
 * enumerate individuals.
 */
export const findFirmByDomain = async (req: Request, res: Response): Promise<void> => {
  const none = () => {
    sendSuccess(res, { firm: null }, "No firm on that domain");
  };
  try {
    const email = String(req.query.email ?? "");
    if (!isEmail(email)) {
      none();
      return;
    }

    const domain = domainOf(email);
    if (!domain) {
      none();
      return;
    }

    const firm = await Firm.findOne({ domain }).select("name");
    if (!firm) {
      none();
      return;
    }

    const memberCount = await FirmMember.countDocuments({ firmId: firm._id, isActive: true });
    sendSuccess(
      res,
      { firm: { id: String(firm._id), name: firm.name, domain, memberCount } },
      "Firm found"
    );
  } catch (error) {
    sendServerError(res, "Could not check that domain", error);
  }
};

/** POST /firm/auth/join-request — ask a firm's partners to let you in. */
export const requestToJoinFirm = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, note } = req.body as { email?: string; note?: string };
    if (!email || !isEmail(email)) {
      sendBadRequest(res, "Enter a valid work email address");
      return;
    }

    const normalised = email.toLowerCase().trim();
    const domain = domainOf(normalised);
    if (!domain) {
      sendNotFound(res, "No firm is registered on that domain");
      return;
    }

    const firm = await Firm.findOne({ domain });
    if (!firm) {
      sendNotFound(res, "No firm is registered on that domain");
      return;
    }

    if (await FirmMember.findOne({ email: normalised, firmId: firm._id })) {
      sendConflict(res, "You already have an account at that firm");
      return;
    }

    // Asking again refreshes the note rather than stacking a second row on the
    // approver's queue.
    await FirmJoinRequest.findOneAndUpdate(
      { firmId: firm._id, email: normalised, status: "pending" },
      {
        firmId: firm._id,
        email: normalised,
        note: note ? String(note).trim().slice(0, 500) : undefined,
        status: "pending",
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Whoever can issue an invitation can approve one of these.
    const approvers = await FirmMember.find({
      firmId: firm._id,
      isActive: true,
      role: { $in: ["managing_partner", "partner", "admin"] },
    }).select("email");

    await Promise.all(
      approvers.map((a) =>
        emailService.sendFirmJoinRequest(a.email, {
          firmName: firm.name,
          requesterEmail: normalised,
          note: note ? String(note).trim() : undefined,
        })
      )
    );

    sendCreated(
      res,
      { firmName: firm.name, approvers: approvers.length },
      "Your request has been sent"
    );
  } catch (error) {
    sendServerError(res, "Could not send the request", error);
  }
};

/**
 * GET /firm/join-requests — the queue, for whoever can act on it.
 *
 * Firm-scoped from the session, so one firm cannot read another's queue.
 */
export const listJoinRequests = async (req: FirmAuthRequest, res: Response): Promise<void> => {
  try {
    const rows = await FirmJoinRequest.find({ firmId: firmIdOf(req), status: "pending" })
      .sort({ createdAt: -1 })
      .select("email note createdAt");

    sendSuccess(
      res,
      {
        requests: rows.map((r) => ({
          id: String(r._id),
          email: r.email,
          note: r.note ?? null,
          askedAt: r.createdAt.toISOString(),
        })),
      },
      "Join requests retrieved"
    );
  } catch (error) {
    sendServerError(res, "Could not list the join requests", error);
  }
};

/**
 * POST /firm/join-requests/:id/decline
 *
 * Deliberately silent to the asker: telling someone their request was turned
 * down invites them to ask again, and the firm may have good reasons it does
 * not want to put in an email.
 */
export const declineJoinRequest = async (req: FirmAuthRequest, res: Response): Promise<void> => {
  try {
    if (!JOIN_APPROVER_ROLES.includes(roleOf(req))) {
      sendForbidden(res, "Only a partner or admin can act on join requests");
      return;
    }

    const updated = await FirmJoinRequest.findOneAndUpdate(
      { _id: req.params.id, firmId: firmIdOf(req), status: "pending" },
      { $set: { status: "declined", decidedBy: memberIdOf(req), decidedAt: new Date() } },
      { new: true }
    );

    if (!updated) {
      sendNotFound(res, "That request is no longer open");
      return;
    }

    sendSuccess(res, { id: String(updated._id) }, "Request declined");
  } catch (error) {
    sendServerError(res, "Could not decline the request", error);
  }
};

/**
 * POST /firm/join-requests/:id/approve — let them in, at a stated role.
 *
 * Approval does not create the member: it issues an ordinary invitation, so
 * the person still sets their own password and the account is created by the
 * same path as every other. The approver chooses the role, because the asker
 * does not get to name their own seniority, and may not choose one above their
 * own — the same rule invitations already enforce.
 */
export const approveJoinRequest = async (req: FirmAuthRequest, res: Response): Promise<void> => {
  try {
    if (!JOIN_APPROVER_ROLES.includes(roleOf(req))) {
      sendForbidden(res, "Only a partner or admin can act on join requests");
      return;
    }

    const { role } = req.body as { role?: string };
    if (!role || !isFirmRole(role)) {
      sendBadRequest(res, "Choose the role to admit them at");
      return;
    }
    // "At or below your own level" — a lower rank is a higher index.
    if (rankOf(role) < rankOf(roleOf(req))) {
      sendForbidden(res, "You cannot admit someone above your own role");
      return;
    }

    const firmId = firmIdOf(req);
    const request = await FirmJoinRequest.findOne({
      _id: req.params.id,
      firmId,
      status: "pending",
    });
    if (!request) {
      sendNotFound(res, "That request is no longer open");
      return;
    }

    if (await FirmMember.findOne({ email: request.email, firmId })) {
      // Someone invited them by hand while this sat in the queue. Close it
      // rather than issuing a second invitation they do not need.
      request.status = "approved";
      request.decidedBy = memberIdOf(req) as never;
      request.decidedAt = new Date();
      await request.save();
      sendConflict(res, "They already have an account at this firm");
      return;
    }

    const firm = await Firm.findById(firmId).select("name");
    const approver = await FirmMember.findById(memberIdOf(req)).select("name");

    // Replace any outstanding invitation rather than stacking a second live
    // token on the same address — the same rule sendInvitations follows.
    await FirmInvitation.deleteMany({
      firmId,
      email: request.email,
      acceptedAt: { $exists: false },
    });

    const token = crypto.randomBytes(32).toString("hex");
    await FirmInvitation.create({
      firmId,
      email: request.email,
      role,
      invitedBy: memberIdOf(req),
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + JOIN_INVITE_TTL_MS),
    });

    const emailed = await emailService.sendFirmInvitation(request.email, {
      firmName: firm?.name ?? "the firm",
      inviterName: approver?.name ?? "A partner",
      role,
      link: `${env.FIRM_APP_URL.replace(/\/$/, "")}/invite/${token}`,
    });

    request.status = "approved";
    request.decidedBy = memberIdOf(req) as never;
    request.decidedAt = new Date();
    await request.save();

    sendSuccess(
      res,
      { id: String(request._id), email: request.email, role, emailed },
      emailed ? "They have been invited" : "Approved, but the invitation email could not be sent"
    );
  } catch (error) {
    sendServerError(res, "Could not approve the request", error);
  }
};

/* ───────────────────────────────────────────────────────────────────────────
 * Switching between firms in-session
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * GET /firm/auth/my-firms — the other firms this person belongs to.
 *
 * The session token is scoped to one firm, so the top bar needs to know
 * whether there is anywhere else to go before it offers a switcher.
 *
 * Matched on the session's own email, never on anything in the request, so
 * this cannot be used to ask about somebody else's memberships.
 */
export const listMyFirms = async (req: FirmAuthRequest, res: Response): Promise<void> => {
  try {
    const email = req.member?.email;
    if (!email) {
      sendUnauthorized(res, "Not signed in");
      return;
    }

    const members = await FirmMember.find({ email, isActive: true }).select("firmId role");
    const firms = await Firm.find({ _id: { $in: members.map((m) => m.firmId) } }).select("name");
    const byId = new Map(firms.map((f) => [String(f._id), f.name]));
    const currentFirmId = String(firmIdOf(req));

    sendSuccess(
      res,
      {
        firms: members
          // A membership whose firm has been deleted would point at nothing.
          .filter((m) => byId.has(String(m.firmId)))
          .map((m) => ({
            memberId: String(m._id),
            firmId: String(m.firmId),
            firmName: byId.get(String(m.firmId))!,
            role: m.role,
            isCurrent: String(m.firmId) === currentFirmId,
          })),
      },
      "Memberships retrieved"
    );
  } catch (error) {
    sendServerError(res, "Could not list your firms", error);
  }
};

/**
 * POST /firm/auth/switch-firm — move the session to another of your firms.
 *
 * No password or code: the person has already proved both to get the session
 * they are holding, and this only moves them between memberships that the same
 * address owns. The membership is matched on the session's email, so a
 * memberId belonging to anyone else is simply not found.
 *
 * It issues a fresh token rather than rewriting one, because the firm id is a
 * claim inside it and every tenancy check in the API reads it from there.
 */
export const switchFirm = async (req: FirmAuthRequest, res: Response): Promise<void> => {
  try {
    const email = req.member?.email;
    if (!email) {
      sendUnauthorized(res, "Not signed in");
      return;
    }

    const { memberId } = req.body as { memberId?: string };
    if (!memberId) {
      sendBadRequest(res, "Which firm?");
      return;
    }

    const member = await FirmMember.findOne({ _id: memberId, email, isActive: true });
    if (!member) {
      sendNotFound(res, "That is not one of your firms");
      return;
    }

    const firm = await Firm.findById(member.firmId);
    if (!firm) {
      sendNotFound(res, "That firm no longer exists");
      return;
    }

    await FirmMember.updateOne({ _id: member._id }, { $set: { lastLogin: new Date() } });

    sendSuccess(
      res,
      { token: signFirmSession(member, firm), member: member.toJSON(), firm },
      `Signed in to ${firm.name}`
    );
  } catch (error) {
    sendServerError(res, "Could not switch firms", error);
  }
};
