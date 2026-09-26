import crypto from "crypto";
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Firm, FirmJoinRequest, FirmMember, FirmSignup, IFirmSignup } from "../../models/firm";
import { emailService } from "../../services/email/email.service";
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
  sendForbidden,
} from "../../utils/response";

function signFirmToken(memberId: string, firmId: string, email: string, role: string) {
  return jwt.sign({ memberId, firmId, email, role, scope: "firm" }, env.JWT_SECRET, {
    expiresIn: "7d",
  });
}

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

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
    const { email, password, deviceToken } = req.body as {
      email?: string;
      password?: string;
      deviceToken?: string;
    };

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
    // opens are the ones this person may enter.
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

    // Correct credentials are only half of a login. The session token is issued
    // by /auth/login/verify once the emailed code comes back, so a stolen
    // password on its own does not reach the firm's matters.
    const memberIds = opened.map((m) => m._id.toString());

    // A browser the member has already trusted skips the code — and only the
    // code. The password was still required to get this far.
    if (deviceToken) {
      const hash = sha256(deviceToken);
      const now = Date.now();
      const trusted = opened.some((m) =>
        (m.trustedDevices ?? []).some((d) => d.tokenHash === hash && d.expiresAt.getTime() > now)
      );
      if (trusted) {
        if (memberIds.length === 1) {
          const session = await issueSessionFor(memberIds[0]);
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
            choiceToken: signFirmChoiceToken(memberIds, member.email),
            firms: await describeMemberships(memberIds),
          },
          "Choose a firm"
        );
        return;
      }
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

    sendSuccess(
      res,
      {
        challengeToken: signLoginChallengeToken(memberIds, member._id.toString(), member.email),
        email: maskEmail(member.email),
        // Lets the screen frame itself as confirming an unrecognised sign-in
        // rather than as a routine second step.
        newDevice: true,
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

const DEVICE_TRUST_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Proves a password was accepted, and nothing more. Not scope "firm", so
 * authenticateFirm rejects it and it cannot reach firm data on its own.
 *
 * It carries every membership that password opened — a lawyer can sit at more
 * than one firm — plus which of them the emailed code was written to.
 */
function signLoginChallengeToken(memberIds: string[], otpMemberId: string, email: string): string {
  return jwt.sign({ memberIds, otpMemberId, email, scope: "firm-login-otp" }, env.JWT_SECRET, {
    expiresIn: "10m",
  });
}

/** Issued once the code is right, to carry the choice of firm and nothing else. */
function signFirmChoiceToken(memberIds: string[], email: string): string {
  return jwt.sign({ memberIds, email, scope: "firm-login-choice" }, env.JWT_SECRET, {
    expiresIn: "10m",
  });
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

/** The firms a set of memberships belongs to, for the "choose a firm" screen. */
async function describeMemberships(memberIds: string[]) {
  const members = await FirmMember.find({ _id: { $in: memberIds } }).select("firmId role name");
  const firms = await Firm.find({ _id: { $in: members.map((m) => m.firmId) } }).select("name");
  const byId = new Map(firms.map((f) => [f._id.toString(), f.name]));
  return members.map((m) => ({
    memberId: m._id.toString(),
    firmId: m.firmId.toString(),
    firmName: byId.get(m.firmId.toString()) ?? "A firm",
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
  return {
    token: signFirmToken(
      member._id.toString(),
      member.firmId.toString(),
      member.email,
      member.role
    ),
    member: member.toJSON(),
    firm,
  };
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

    const { code, trustDevice } = req.body as { code?: string; trustDevice?: boolean };
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

    // Single use: the code dies with the session it produced.
    await FirmMember.updateOne(
      { _id: member._id },
      {
        $unset: {
          loginOtpHash: "",
          loginOtpExpiresAt: "",
          loginOtpAttempts: "",
          loginOtpSentAt: "",
        },
      }
    );

    // "Trust this device" is recorded against every membership the password
    // opened, so a second firm on the same browser is not asked again.
    let issuedDeviceToken: string | undefined;
    if (trustDevice) {
      issuedDeviceToken = crypto.randomBytes(32).toString("hex");
      await FirmMember.updateMany(
        { _id: { $in: claims.memberIds } },
        {
          $push: {
            trustedDevices: {
              tokenHash: sha256(issuedDeviceToken),
              expiresAt: new Date(Date.now() + DEVICE_TRUST_MS),
              createdAt: new Date(),
            },
          },
        }
      );
    }

    // More than one firm answered to that password, so the person picks.
    if (claims.memberIds.length > 1) {
      sendSuccess(
        res,
        {
          needsFirmChoice: true,
          choiceToken: signFirmChoiceToken(claims.memberIds, member.email),
          firms: await describeMemberships(claims.memberIds),
          deviceToken: issuedDeviceToken,
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

    sendSuccess(res, { ...session, deviceToken: issuedDeviceToken }, "Logged in");
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

    const member = await FirmMember.findOne({ email: email.toLowerCase().trim() });

    // A locked account still gets a link, and the locked screen offers one as
    // the way out. The lockout stops password guessing; it cannot sensibly stop
    // someone who controls the inbox, who can already reset the password by the
    // same route. Blocking one and not the other adds nothing and only strands
    // the person whose account it actually is.
    if (member && member.isActive) {
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
 * POST /firm/auth/login/firm — pick which firm to enter.
 *
 * Only reachable with a choice token, which is only issued once the password
 * and the code have both been accepted. The chosen membership has to be one of
 * the set that token was minted for, so this cannot be used to enter a firm the
 * password never opened.
 */
export const chooseLoginFirm = async (req: Request, res: Response): Promise<void> => {
  try {
    const claims = readScopedToken(req, "firm-login-choice");
    if (!claims) {
      sendUnauthorized(res, "That sign-in attempt has expired. Log in again.");
      return;
    }

    const { memberId } = req.body as { memberId?: string };
    if (!memberId || !claims.memberIds.includes(String(memberId))) {
      sendForbidden(res, "That is not one of the firms you can enter");
      return;
    }

    const session = await issueSessionFor(String(memberId));
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
 * GET /firm/auth/firm-by-domain?email= — is a colleague's firm already here?
 *
 * Public, and it does say that a firm exists on a domain. That is a deliberate
 * trade: without it, the second person at a firm silently creates a duplicate
 * and the practice ends up split across two accounts that cannot see each
 * other's matters. It returns only the firm's name and how many people are in
 * it — nothing that is not already obvious to anyone who works there.
 */
export const findFirmByDomain = async (req: Request, res: Response): Promise<void> => {
  try {
    const email = String(req.query.email ?? "");
    if (!isEmail(email)) {
      sendSuccess(res, { firm: null }, "No firm on that domain");
      return;
    }

    const domain = email.toLowerCase().trim().split("@")[1];
    // Free mailboxes are not firms; matching on them would offer to put every
    // gmail signup into whichever firm registered on gmail first.
    const PUBLIC_DOMAINS = [
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
    if (!domain || PUBLIC_DOMAINS.includes(domain)) {
      sendSuccess(res, { firm: null }, "No firm on that domain");
      return;
    }

    const firm = await Firm.findOne({ domain }).select("name");
    if (!firm) {
      sendSuccess(res, { firm: null }, "No firm on that domain");
      return;
    }

    const memberCount = await FirmMember.countDocuments({ firmId: firm._id, isActive: true });
    sendSuccess(
      res,
      { firm: { id: firm._id.toString(), name: firm.name, domain, memberCount } },
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
    const domain = normalised.split("@")[1];
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
