import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { sendResendMail } from "./resend.service";
import { isZeptoApiConfigured, sendZeptoApiMail } from "./zepto-api.service";
import { sendZeptoMail } from "./zepto-transport";
import { sendZohoMail } from "./zoho-transport";

export type MailOptions = {
  to: string;
  subject: string;
  html: string;
};

const isZeptoSmtpConfigured = (): boolean => Boolean(env.ZEPTO_SMTP_PASS && env.ZEPTO_MAIL_FROM);

const isZohoConfigured = (): boolean =>
  Boolean(env.ZOHO_SMTP_USER && env.ZOHO_SMTP_PASS && env.ZOHO_MAIL_FROM);

const isResendConfigured = (): boolean => Boolean(env.RESEND_API_KEY && env.RESEND_FROM);

const anyProviderConfigured = (): boolean =>
  isZeptoSmtpConfigured() || isZeptoApiConfigured() || isZohoConfigured() || isResendConfigured();

/**
 * ZeptoMail SMTP → Zoho SMTP → ZeptoMail API → Resend.
 * SMTP uses 10s connection timeouts (see zepto/zoho transports).
 */
export const sendEmail = async (options: MailOptions): Promise<boolean> => {
  if (!anyProviderConfigured()) {
    logger.error("Email delivery skipped — configure ZeptoMail, Zoho SMTP, and/or Resend", {
      to: options.to,
      subject: options.subject,
    });
    return false;
  }

  if (isZeptoSmtpConfigured()) {
    const zeptoOk = await sendZeptoMail({
      ...options,
      from: env.ZEPTO_MAIL_FROM!,
    });
    if (zeptoOk) return true;
    logger.warn("ZeptoMail SMTP failed — trying next provider", {
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
      logger.info("Email delivered via Zoho SMTP", {
        to: options.to,
        subject: options.subject,
      });
      return true;
    }
    logger.warn("Zoho SMTP failed — trying next provider", {
      to: options.to,
      subject: options.subject,
    });
  }

  if (isZeptoApiConfigured()) {
    const zeptoApiOk = await sendZeptoApiMail({
      ...options,
      from: env.ZEPTO_MAIL_FROM!,
    });
    if (zeptoApiOk) {
      logger.info("Email delivered via ZeptoMail API", {
        to: options.to,
        subject: options.subject,
      });
      return true;
    }
    logger.warn("ZeptoMail API failed — trying Resend fallback", {
      to: options.to,
      subject: options.subject,
    });
  }

  if (!isResendConfigured()) {
    logger.error("Email delivery failed — no provider succeeded", {
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

  logger.error("Email delivery failed (all providers)", {
    to: options.to,
    subject: options.subject,
  });
  return false;
};
