import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { isBrevoConfigured, sendBrevoMail } from "./brevo-api.service";
import { isSesConfigured, sendSesMail } from "./ses.service";
import { isSuppressed } from "../../models/SuppressedEmail";

export type MailOptions = {
  to: string;
  subject: string;
  html: string;
};

const isConfigured = (): boolean => isBrevoConfigured() || isSesConfigured();

/**
 * Brevo Transactional API first, then AWS SES as fallback.
 */
export const sendEmail = async (options: MailOptions): Promise<boolean> => {
  if (!isConfigured()) {
    logger.error("Email delivery skipped — set BREVO_API_KEY and/or AWS_SES_FROM_EMAIL env vars", {
      to: options.to,
      subject: options.subject,
    });
    return false;
  }

  // Suppressed addresses are never written to again. SES judges a sender by how
  // much mail they send to dead mailboxes and to people who reported them, and
  // losing sending access would take every sign-in down with it — so this check
  // guards the channel the product's auth depends on, not just one send.
  if (await isSuppressed(options.to)) {
    logger.warn("Email suppressed — address previously hard-bounced or complained", {
      to: options.to,
      subject: options.subject,
    });
    return false;
  }

  if (isBrevoConfigured()) {
    const ok = await sendBrevoMail({ ...options, from: env.BREVO_MAIL_FROM! });
    if (ok) {
      logger.info("Email delivered via Brevo", { to: options.to, subject: options.subject });
      return true;
    }
    logger.warn("Brevo failed — falling back to AWS SES", {
      to: options.to,
      subject: options.subject,
    });
  }

  if (isSesConfigured()) {
    const ok = await sendSesMail(options);
    if (ok) {
      logger.info("Email delivered via AWS SES", { to: options.to, subject: options.subject });
      return true;
    }
  }

  logger.error("Email delivery failed — Brevo and AWS SES both failed", {
    to: options.to,
    subject: options.subject,
  });
  return false;
};
