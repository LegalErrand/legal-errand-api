import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { isBrevoConfigured, sendBrevoMail } from "./brevo-api.service";
import { isSesConfigured, sendSesMail } from "./ses.service";

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
