import crypto from "crypto";
import { logger } from "../../utils/logger";

/**
 * Verifies that an SNS message really came from AWS.
 *
 * ── Why this is not optional ────────────────────────────────────────────────
 * The webhook this guards is public — SNS has no credentials to present, so the
 * signature is the only thing distinguishing a real AWS notification from a
 * stranger's POST. And the endpoint's effect is to suppress an email address.
 *
 * Without verification, anyone who found the URL could forge a complaint for
 * any address and permanently stop that person receiving mail. Since every
 * sign-in needs an emailed code, that is a targeted, lasting account lockout
 * against any user whose email address the attacker knows. So an unverified
 * message is dropped, and it is dropped before anything is written.
 */

/** PEM certificates, keyed by URL. AWS rotates rarely; this saves a fetch. */
const certCache = new Map<string, string>();

/**
 * The signing certificate must live on an SNS host inside amazonaws.com.
 *
 * This is the check that stops the obvious attack: a forged message naming the
 * attacker's own `SigningCertURL`, which would otherwise have us fetch their
 * certificate and dutifully verify their signature against it. It also stops
 * the URL being used to make the server fetch arbitrary addresses.
 */
const isAwsCertUrl = (url: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  // sns.<region>.amazonaws.com, or the China partition's .com.cn.
  return /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(parsed.hostname);
};

async function getCertificate(url: string): Promise<string | null> {
  const cached = certCache.get(url);
  if (cached) return cached;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn("SNS signing certificate fetch failed", { url, status: res.status });
      return null;
    }
    const pem = await res.text();
    certCache.set(url, pem);
    return pem;
  } catch (err) {
    logger.warn("SNS signing certificate could not be retrieved", {
      url,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * The exact fields AWS signs, in the exact order, per message type.
 *
 * Order and membership are part of the protocol: a field appended out of order,
 * or an optional field included when absent, produces a different string and
 * the signature fails. Optional members are skipped when not present.
 */
const SIGNED_FIELDS: Record<string, string[]> = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: [
    "Message",
    "MessageId",
    "SubscribeURL",
    "Timestamp",
    "Token",
    "TopicArn",
    "Type",
  ],
  UnsubscribeConfirmation: [
    "Message",
    "MessageId",
    "SubscribeURL",
    "Timestamp",
    "Token",
    "TopicArn",
    "Type",
  ],
};

const canonicalStringFor = (message: Record<string, unknown>): string | null => {
  const fields = SIGNED_FIELDS[String(message.Type)];
  if (!fields) return null;

  let out = "";
  for (const field of fields) {
    const value = message[field];
    // Subject is genuinely optional; everything else absent means malformed.
    if (value === undefined || value === null) continue;
    out += `${field}\n${String(value)}\n`;
  }
  return out;
};

export interface SnsMessage {
  Type?: string;
  MessageId?: string;
  TopicArn?: string;
  Message?: string;
  Timestamp?: string;
  Signature?: string;
  SignatureVersion?: string;
  SigningCertURL?: string;
  SubscribeURL?: string;
  Token?: string;
  Subject?: string;
}

/**
 * True only when the message is genuinely from AWS and unmodified.
 *
 * Every failure path returns false and logs why. Nothing throws, so a malformed
 * POST cannot take the endpoint down.
 */
export async function verifySnsMessage(message: SnsMessage): Promise<boolean> {
  const { Signature, SignatureVersion, SigningCertURL } = message;

  if (!Signature || !SigningCertURL || !SignatureVersion) {
    logger.warn("SNS message rejected — missing signature fields", { type: message.Type });
    return false;
  }

  if (!isAwsCertUrl(SigningCertURL)) {
    logger.warn("SNS message rejected — signing certificate URL is not an AWS SNS host", {
      SigningCertURL,
    });
    return false;
  }

  // Version 1 signs with SHA1, version 2 with SHA256. Anything else is not a
  // scheme we know, so it is refused rather than guessed at.
  const algorithm =
    SignatureVersion === "1" ? "RSA-SHA1" : SignatureVersion === "2" ? "RSA-SHA256" : null;
  if (!algorithm) {
    logger.warn("SNS message rejected — unknown SignatureVersion", { SignatureVersion });
    return false;
  }

  const canonical = canonicalStringFor(message as Record<string, unknown>);
  if (!canonical) {
    logger.warn("SNS message rejected — unknown message Type", { type: message.Type });
    return false;
  }

  const pem = await getCertificate(SigningCertURL);
  if (!pem) return false;

  try {
    const verifier = crypto.createVerify(algorithm);
    verifier.update(canonical, "utf8");
    const ok = verifier.verify(pem, Signature, "base64");
    if (!ok) {
      logger.warn("SNS message rejected — signature did not verify", {
        type: message.Type,
        messageId: message.MessageId,
      });
    }
    return ok;
  } catch (err) {
    logger.warn("SNS signature verification errored", {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
