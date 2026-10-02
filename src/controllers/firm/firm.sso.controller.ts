import { Request, Response } from "express";
import { Firm, FirmMember } from "../../models/firm";
import { verifyGoogleAccessToken } from "../../services/auth/google.service";
import { verifyMicrosoftAccessToken } from "../../services/auth/microsoft.service";
import { signFirmSession } from "./firm.auth.controller";
import {
  sendSuccess,
  sendBadRequest,
  sendUnauthorized,
  sendServerError,
} from "../../utils/response";

type Provider = "google" | "microsoft";

const isProvider = (value: unknown): value is Provider =>
  value === "google" || value === "microsoft";

/**
 * GET /firm/auth/sso/policy?email=…
 *
 * Public. The login screen asks before it draws itself, so a firm that
 * requires SSO never shows a password field its staff cannot use.
 *
 * It answers only whether SSO is required and by whom. It must not reveal
 * whether the address belongs to an account — an unknown email gets the same
 * shape of answer as a known one on a firm with no policy.
 */
export const getSsoPolicy = async (req: Request, res: Response): Promise<void> => {
  try {
    const email = String(req.query.email ?? "")
      .toLowerCase()
      .trim();
    const none = { requiresSso: false, provider: null as Provider | null };

    if (!email) {
      sendSuccess(res, none, "Sign-in policy");
      return;
    }

    const member = await FirmMember.findOne({ email }).select("firmId").lean();
    if (!member) {
      sendSuccess(res, none, "Sign-in policy");
      return;
    }

    const firm = await Firm.findById(member.firmId).select("requiresSso ssoProvider").lean();
    if (!firm?.requiresSso || !firm.ssoProvider) {
      sendSuccess(res, none, "Sign-in policy");
      return;
    }

    sendSuccess(res, { requiresSso: true, provider: firm.ssoProvider }, "Sign-in policy");
  } catch (error) {
    sendServerError(res, "Could not read the sign-in policy", error);
  }
};

/**
 * POST /firm/auth/sso — { provider, token }
 *
 * The token comes from Google or Microsoft in the browser; we spend it against
 * that provider to learn who it belongs to. A forged one cannot be spent.
 *
 * **This issues a session directly, with no emailed code.** The standing rule
 * is that a *password* alone must not produce a session; SSO uses no password
 * of ours, and the identity provider has already applied its own second
 * factor. Confirmed 2026-10-02.
 */
export const signInWithSso = async (req: Request, res: Response): Promise<void> => {
  try {
    const { provider, token } = req.body as { provider?: string; token?: string };

    if (!isProvider(provider)) {
      sendBadRequest(res, "Choose Google or Microsoft");
      return;
    }
    if (!token?.trim()) {
      sendBadRequest(res, "That sign-in did not complete");
      return;
    }

    let email: string;
    let providerId: string;
    try {
      if (provider === "google") {
        const profile = await verifyGoogleAccessToken(token);
        email = profile.email.toLowerCase().trim();
        providerId = profile.googleId;
      } else {
        const profile = await verifyMicrosoftAccessToken(token);
        email = profile.email;
        providerId = profile.microsoftId;
      }
    } catch (err) {
      sendUnauthorized(
        res,
        err instanceof Error ? err.message : "That sign-in could not be verified"
      );
      return;
    }

    // SSO signs people in; it does not create firms. Somebody who has never
    // been invited has no firm to land in, and guessing one would be worse
    // than telling them.
    const member = await FirmMember.findOne({ email }).select("+googleId +microsoftId");
    if (!member || member.isActive === false) {
      sendUnauthorized(
        res,
        "That account is not set up on LegalErrand. Ask your firm to invite you."
      );
      return;
    }

    const firm = await Firm.findById(member.firmId);
    if (!firm) {
      sendUnauthorized(res, "This account is no longer active");
      return;
    }

    // A firm that requires one provider must not be reachable through the
    // other — otherwise the policy is a suggestion.
    if (firm.requiresSso && firm.ssoProvider && firm.ssoProvider !== provider) {
      sendUnauthorized(
        res,
        `${firm.name} signs in with ${firm.ssoProvider === "google" ? "Google" : "Microsoft"}`
      );
      return;
    }

    // First sign-in with this provider links it to the account they already
    // had, so a password user does not end up with a second record.
    const field = provider === "google" ? "googleId" : "microsoftId";
    const linked = member.get(field) as string | undefined;
    if (!linked) {
      member.set(field, providerId);
    } else if (linked !== providerId) {
      sendUnauthorized(res, "That account is linked to a different sign-in");
      return;
    }

    member.lastLogin = new Date();
    await member.save();

    const sessionToken = signFirmSession(member, firm);
    sendSuccess(res, { token: sessionToken, member: member.toJSON(), firm }, "Logged in");
  } catch (error) {
    sendServerError(res, "Could not complete that sign-in", error);
  }
};
