import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { sendResendMail } from "./resend.service";
import { sendZohoMail } from "./zoho-transport";

export type MailOptions = {
  to: string;
  subject: string;
  html: string;
  from?: string;
};

/** Default sender for transactional mail (Zoho preferred, Resend as fallback). */
export const defaultMailFrom = (): string =>
  env.ZOHO_MAIL_FROM ?? env.RESEND_FROM ?? "LegalErrand <noreply@legalerrand.com>";

/**
 * Sends email via Zoho SMTP first; falls back to Resend when Zoho is unconfigured or fails.
 */
export const sendEmail = async (options: MailOptions): Promise<boolean> => {
  const from = options.from ?? defaultMailFrom();

  const zohoOk = await sendZohoMail({ ...options, from });
  if (zohoOk) {
    return true;
  }

  const resendFrom = env.RESEND_FROM ?? from;
  const resendOk = await sendResendMail({ ...options, from: resendFrom });
  if (resendOk) {
    logger.info("Email delivered via Resend (Zoho unavailable or failed)", {
      to: options.to,
      subject: options.subject,
    });
    return true;
  }

  logger.error("Email delivery failed (Zoho and Resend)", {
    to: options.to,
    subject: options.subject,
  });
  return false;
};
