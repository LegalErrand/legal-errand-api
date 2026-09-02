import { env } from "../../config/env";
import { logger } from "../../utils/logger";

export interface GoogleProfile {
  googleId: string;
  email: string;
  firstName: string;
  lastName: string;
  picture?: string;
}

interface GoogleTokenInfo {
  aud?: string;
  azp?: string;
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
  given_name?: string;
  family_name?: string;
  name?: string;
  picture?: string;
  error?: string;
  error_description?: string;
}

function isVerifiedEmail(value: string | boolean | undefined): boolean {
  return value === true || value === "true";
}

function audienceMatches(info: GoogleTokenInfo, clientId: string): boolean {
  return info.aud === clientId || info.azp === clientId;
}

export async function verifyGoogleAccessToken(accessToken: string): Promise<GoogleProfile> {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID is not configured");
  }

  const url = `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  const info = (await res.json()) as GoogleTokenInfo;

  if (!res.ok || info.error || !info.sub || !info.email) {
    logger.warn("Google tokeninfo failed", {
      status: res.status,
      error: info.error ?? info.error_description,
    });
    throw new Error("invalid_google_token");
  }

  if (!audienceMatches(info, clientId)) {
    logger.warn("Google token audience mismatch", { aud: info.aud, azp: info.azp });
    throw new Error("invalid_google_token");
  }

  if (!isVerifiedEmail(info.email_verified)) {
    throw new Error("unverified_google_email");
  }

  let given = info.given_name?.trim();
  let family = info.family_name?.trim();
  let picture = info.picture;

  if (!given || !family) {
    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (userInfoRes.ok) {
      const userInfo = (await userInfoRes.json()) as GoogleTokenInfo;
      given = given || userInfo.given_name?.trim();
      family = family || userInfo.family_name?.trim();
      picture = picture || userInfo.picture;
    }
  }

  const emailLocal = info.email.split("@")[0] ?? "User";
  return {
    googleId: info.sub,
    email: info.email.toLowerCase(),
    firstName: given || emailLocal,
    lastName: family || "Student",
    picture,
  };
}
