import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { sendZeptoApiMail, isZeptoApiConfigured } from "./zepto-api.service";
import { sendZeptoMail } from "./zepto-transport";
import { isZohoConfigured, sendZohoMail } from "./zoho-transport";

export type MailOptions = {
  to: string;
  subject: string;
  html: string;
};

const isConfigured = (): boolean => isZeptoApiConfigured() || isZohoConfigured();

/**
 * ZeptoMail API first, then Zoho SMTP, then ZeptoMail SMTP.
 */
export const sendEmail = async (options: MailOptions): Promise<boolean> => {
  if (!isConfigured()) {
    logger.error("Email delivery skipped — set ZEPTO_* and/or ZOHO_* mail env vars", {
      to: options.to,
      subject: options.subject,
    });
    return false;
  }

  if (isZeptoApiConfigured()) {
    const apiOk = await sendZeptoApiMail({ ...options, from: env.ZEPTO_MAIL_FROM! });
    if (apiOk) {
      logger.info("Email delivered via ZeptoMail API", {
        to: options.to,
        subject: options.subject,
      });
      return true;
    }
    logger.warn("ZeptoMail API failed — falling back to Zoho SMTP", {
      to: options.to,
      subject: options.subject,
    });
  }

  if (isZohoConfigured()) {
    const zohoOk = await sendZohoMail({ ...options, from: env.ZOHO_MAIL_FROM! });
    if (zohoOk) {
      logger.info("Email delivered via Zoho SMTP", { to: options.to, subject: options.subject });
      return true;
    }
    logger.warn("Zoho SMTP failed — falling back to ZeptoMail SMTP", {
      to: options.to,
      subject: options.subject,
    });
  }

  if (isZeptoApiConfigured()) {
    const smtpOk = await sendZeptoMail({ ...options, from: env.ZEPTO_MAIL_FROM! });
    if (smtpOk) {
      logger.info("Email delivered via ZeptoMail SMTP", {
        to: options.to,
        subject: options.subject,
      });
      return true;
    }
  }

  logger.error("Email delivery failed — ZeptoMail API, Zoho SMTP, and ZeptoMail SMTP all failed", {
    to: options.to,
    subject: options.subject,
  });
  return false;
};
