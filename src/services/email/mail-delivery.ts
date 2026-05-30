import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { sendResendMail } from "./resend.service";
import { sendZeptoMail } from "./zepto-transport";
import { sendZohoMail } from "./zoho-transport";

export type MailOptions = {
  to: string;
  subject: string;
  html: string;
};

const isZeptoConfigured = (): boolean => Boolean(env.ZEPTO_SMTP_PASS && env.ZEPTO_MAIL_FROM);

const isZohoConfigured = (): boolean =>
  Boolean(env.ZOHO_SMTP_USER && env.ZOHO_SMTP_PASS && env.ZOHO_MAIL_FROM);

const isResendConfigured = (): boolean => Boolean(env.RESEND_API_KEY && env.RESEND_FROM);

const anyProviderConfigured = (): boolean =>
  isZeptoConfigured() || isZohoConfigured() || isResendConfigured();

/**
 * Sends email: ZeptoMail SMTP (primary) → Zoho SMTP → Resend API.
 * Each provider uses its own verified `from` address.
 */
export const sendEmail = async (options: MailOptions): Promise<boolean> => {
  if (!anyProviderConfigured()) {
    logger.error("Email delivery skipped — configure ZeptoMail, Zoho SMTP, and/or Resend", {
      to: options.to,
      subject: options.subject,
    });
    return false;
  }

  if (isZeptoConfigured()) {
    const zeptoOk = await sendZeptoMail({
      ...options,
      from: env.ZEPTO_MAIL_FROM!,
    });
    if (zeptoOk) {
      return true;
    }
    logger.warn("ZeptoMail send failed — trying fallback providers", {
      to: options.to,
      subject: options.subject,
    });
  }

  if (isZohoConfigured()) {
    const zohoOk = await sendZohoMail({
      ...options,
      from: env.ZOHO_MAIL_FROM!,
    });
    if (zohoOk) {
      logger.info("Email delivered via Zoho (ZeptoMail fallback)", {
        to: options.to,
        subject: options.subject,
      });
      return true;
    }
    logger.warn("Zoho send failed — trying Resend fallback", {
      to: options.to,
      subject: options.subject,
    });
  }

  if (!isResendConfigured()) {
    logger.error("Email delivery failed — no fallback provider succeeded", {
      to: options.to,
      subject: options.subject,
    });
    return false;
  }

  const resendOk = await sendResendMail({
    ...options,
    from: env.RESEND_FROM!,
  });

  if (resendOk) {
    logger.info("Email delivered via Resend", {
      to: options.to,
      subject: options.subject,
    });
    return true;
  }

  logger.error("Email delivery failed (ZeptoMail, Zoho, and Resend)", {
    to: options.to,
    subject: options.subject,
  });
  return false;
};
