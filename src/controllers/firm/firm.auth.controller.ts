import crypto from "crypto";
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Firm, FirmMember, FirmSignup, IFirmSignup } from "../../models/firm";
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
} from "../../utils/response";

function signFirmToken(memberId: string, firmId: string, email: string, role: string) {
  return jwt.sign({ memberId, firmId, email, role, scope: "firm" }, env.JWT_SECRET, {
    expiresIn: "7d",
  });
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

    sendSuccess(
      res,
      {
        challengeToken: signLoginChallengeToken(member._id.toString(), member.email),
        email: maskEmail(member.email),
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

/**
 * Proves a password was accepted, and nothing more. Not scope "firm", so
 * authenticateFirm rejects it and it cannot reach firm data on its own.
 */
function signLoginChallengeToken(memberId: string, email: string): string {
  return jwt.sign({ memberId, email, scope: "firm-login-otp" }, env.JWT_SECRET, {
    expiresIn: "10m",
  });
}

function readLoginChallengeToken(req: Request): { memberId: string; email: string } | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const decoded = jwt.verify(header.split(" ")[1], env.JWT_SECRET) as {
      memberId?: string;
      email?: string;
      scope?: string;
    };
    if (decoded.scope !== "firm-login-otp" || !decoded.memberId || !decoded.email) return null;
    return { memberId: decoded.memberId, email: decoded.email };
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
    const claims = readLoginChallengeToken(req);
    if (!claims) {
      sendUnauthorized(res, "That sign-in attempt has expired. Log in again.");
      return;
    }

    const { code } = req.body as { code?: string };
    if (!code) {
      sendBadRequest(res, "Enter the six-digit code");
      return;
    }

    const member = await FirmMember.findById(claims.memberId).select(
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

    const token = signFirmToken(
      member._id.toString(),
      member.firmId.toString(),
      member.email,
      member.role
    );

    sendSuccess(res, { token, member: member.toJSON(), firm }, "Logged in");
  } catch (error) {
    sendServerError(res, "Could not verify the code", error);
  }
};

/** POST /firm/auth/login/resend — a fresh login code, behind the same cooldown. */
export const resendLoginOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const claims = readLoginChallengeToken(req);
    if (!claims) {
      sendUnauthorized(res, "That sign-in attempt has expired. Log in again.");
      return;
    }

    const member = await FirmMember.findById(claims.memberId).select("+loginOtpSentAt");
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
