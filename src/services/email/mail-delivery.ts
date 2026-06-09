import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { sendZeptoApiMail } from "./zepto-api.service";
import { sendZeptoMail } from "./zepto-transport";

export type MailOptions = {
  to: string;
  subject: string;
  html: string;
};

const isConfigured = (): boolean => Boolean(env.ZEPTO_SMTP_PASS && env.ZEPTO_MAIL_FROM);

/**
 * ZeptoMail SMTP first, falls back to ZeptoMail API if SMTP fails.
 */
export const sendEmail = async (options: MailOptions): Promise<boolean> => {
  if (!isConfigured()) {
    logger.error("Email delivery skipped — set ZEPTO_SMTP_PASS and ZEPTO_MAIL_FROM", {
      to: options.to,
      subject: options.subject,
    });
    return false;
  }

  const smtpOk = await sendZeptoMail({ ...options, from: env.ZEPTO_MAIL_FROM! });
  if (smtpOk) return true;

  logger.warn("ZeptoMail SMTP failed — falling back to ZeptoMail API", {
    to: options.to,
    subject: options.subject,
  });

  const apiOk = await sendZeptoApiMail({ ...options, from: env.ZEPTO_MAIL_FROM! });
  if (apiOk) {
    logger.info("Email delivered via ZeptoMail API", { to: options.to, subject: options.subject });
    return true;
  }

  logger.error("Email delivery failed — both ZeptoMail SMTP and API failed", {
    to: options.to,
    subject: options.subject,
  });
  return false;
};
