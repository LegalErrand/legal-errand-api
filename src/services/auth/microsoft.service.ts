import { env } from "../../config/env";
import { logger } from "../../utils/logger";

export interface MicrosoftProfile {
  microsoftId: string;
  email: string;
  firstName: string;
  lastName: string;
}

interface GraphMe {
  id?: string;
  mail?: string | null;
  userPrincipalName?: string;
  givenName?: string | null;
  surname?: string | null;
  error?: { message?: string };
}

/**
 * Verifies a Microsoft access token by spending it against Graph.
 *
 * Asking Graph who the token belongs to is the verification: a forged or
 * expired token cannot read /me. That avoids having to fetch and rotate
 * Microsoft's signing keys to validate an id_token locally.
 */
export async function verifyMicrosoftAccessToken(accessToken: string): Promise<MicrosoftProfile> {
  if (!env.MICROSOFT_CLIENT_ID?.trim()) {
    throw new Error("MICROSOFT_CLIENT_ID is not configured");
  }

  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const body = (await res.json().catch(() => null)) as GraphMe | null;

  if (!res.ok || !body?.id) {
    logger.warn("Microsoft token rejected", { status: res.status, message: body?.error?.message });
    throw new Error("That Microsoft sign-in could not be verified");
  }

  // Work accounts carry `mail`; some tenants only set userPrincipalName.
  const email = (body.mail ?? body.userPrincipalName ?? "").toLowerCase().trim();
  if (!email) {
    throw new Error("That Microsoft account has no email address");
  }

  return {
    microsoftId: body.id,
    email,
    firstName: body.givenName ?? "",
    lastName: body.surname ?? "",
  };
}
