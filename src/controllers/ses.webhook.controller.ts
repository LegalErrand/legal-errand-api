import { Request, Response } from "express";
import { SuppressedEmail, SuppressionReason } from "../models/SuppressedEmail";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { verifySnsMessage, SnsMessage } from "../services/email/sns-verify";

/**
 * SES bounce and complaint notifications, delivered by SNS.
 *
 * ── Contract with SNS ───────────────────────────────────────────────────────
 * SNS expects 2xx quickly. A non-2xx is retried, and repeated failures end with
 * the subscription disabled — at which point bounces stop being recorded and we
 * are back to the problem this endpoint exists to solve. So every path here
 * answers 200, including the ones that reject the message: a forged POST is not
 * SNS's problem to retry. The only thing a 4xx would achieve is noise.
 *
 * ── What it trusts ──────────────────────────────────────────────────────────
 * Nothing, until `verifySnsMessage` passes. Optionally also a topic allow-list
 * via SES_SNS_TOPIC_ARN, so a valid AWS signature from somebody else's topic in
 * another account cannot write to our suppression list.
 */

/** SNS posts JSON as text/plain, which express.json() leaves alone. */
const parseBody = (req: Request): SnsMessage | null => {
  const body: unknown = req.body;
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as SnsMessage;
    } catch {
      return null;
    }
  }
  if (body && typeof body === "object" && Object.keys(body).length > 0) {
    return body as SnsMessage;
  }
  return null;
};

const ok = (res: Response, note: string): void => {
  res.status(200).json({ received: true, note });
};

/** Records one address, keeping the first reason rather than overwriting it. */
async function suppress(
  email: string,
  reason: SuppressionReason,
  extra: { bounceType?: string; bounceSubType?: string; diagnostic?: string; sesMessageId?: string }
): Promise<void> {
  const address = email.toLowerCase().trim();
  if (!address) return;

  await SuppressedEmail.findOneAndUpdate(
    { email: address },
    {
      $setOnInsert: {
        email: address,
        reason,
        at: new Date(),
        ...extra,
      },
    },
    { upsert: true, new: false, setDefaultsOnInsert: true }
  );

  logger.warn("Email address suppressed", { email: address, reason, ...extra });
}

export const handleSesNotification = async (req: Request, res: Response): Promise<void> => {
  const message = parseBody(req);
  if (!message || !message.Type) {
    logger.warn("SES webhook received an unparseable body");
    ok(res, "ignored");
    return;
  }

  if (!(await verifySnsMessage(message))) {
    // Deliberately a 200: an unverified message is not AWS asking us to retry.
    ok(res, "ignored");
    return;
  }

  if (env.SES_SNS_TOPIC_ARN && message.TopicArn !== env.SES_SNS_TOPIC_ARN) {
    logger.warn("SES webhook rejected — unexpected topic", { topic: message.TopicArn });
    ok(res, "ignored");
    return;
  }

  // ── Subscription handshake ───────────────────────────────────────────────
  // SNS confirms a subscription by posting a URL it wants visited. It is only
  // visited once the signature and topic have already been checked above, so
  // this cannot be used to make the server fetch an arbitrary address.
  if (message.Type === "SubscriptionConfirmation") {
    if (!message.SubscribeURL) {
      ok(res, "ignored");
      return;
    }
    try {
      const r = await fetch(message.SubscribeURL);
      logger.info("SES SNS subscription confirmed", { status: r.status });
    } catch (err) {
      logger.error("SES SNS subscription confirmation failed", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
    ok(res, "subscription confirmed");
    return;
  }

  if (message.Type !== "Notification") {
    ok(res, "ignored");
    return;
  }

  // ── The SES event itself ─────────────────────────────────────────────────
  let event: {
    notificationType?: string;
    eventType?: string;
    bounce?: {
      bounceType?: string;
      bounceSubType?: string;
      bouncedRecipients?: Array<{ emailAddress?: string; diagnosticCode?: string }>;
    };
    complaint?: {
      complainedRecipients?: Array<{ emailAddress?: string }>;
      complaintFeedbackType?: string;
    };
    mail?: { messageId?: string };
  };
  try {
    event = JSON.parse(message.Message ?? "{}");
  } catch {
    logger.warn("SES notification payload was not JSON");
    ok(res, "ignored");
    return;
  }

  // SES uses notificationType on the older format and eventType on event
  // publishing. Reading both means this works whichever is configured.
  const kind = event.notificationType ?? event.eventType;
  const sesMessageId = event.mail?.messageId;

  if (kind === "Bounce" && event.bounce) {
    const { bounceType, bounceSubType, bouncedRecipients = [] } = event.bounce;

    // Only Permanent bounces suppress. A Transient bounce is a full mailbox or
    // a timeout — temporary by definition, and suppressing it would lock a real
    // user out of their account over something that fixes itself.
    if (bounceType !== "Permanent") {
      logger.info("SES transient bounce noted, not suppressed", {
        bounceType,
        bounceSubType,
        count: bouncedRecipients.length,
      });
      ok(res, "transient bounce noted");
      return;
    }

    for (const r of bouncedRecipients) {
      if (!r.emailAddress) continue;
      await suppress(r.emailAddress, "bounce", {
        bounceType,
        bounceSubType,
        diagnostic: r.diagnosticCode,
        sesMessageId,
      });
    }
    ok(res, "bounce recorded");
    return;
  }

  if (kind === "Complaint" && event.complaint) {
    for (const r of event.complaint.complainedRecipients ?? []) {
      if (!r.emailAddress) continue;
      await suppress(r.emailAddress, "complaint", {
        bounceSubType: event.complaint.complaintFeedbackType,
        sesMessageId,
      });
    }
    ok(res, "complaint recorded");
    return;
  }

  // Deliveries and everything else are acknowledged without being stored.
  // There is no value in a row per successful send, and plenty of cost.
  logger.info("SES notification acknowledged", { kind });
  ok(res, "acknowledged");
};
