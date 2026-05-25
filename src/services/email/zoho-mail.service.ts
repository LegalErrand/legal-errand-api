import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { WAITLIST_EMAIL_SUBJECT, buildWaitlistEmailHtml } from "./waitlist-email.template";

let transporter: nodemailer.Transporter<SMTPTransport.SentMessageInfo> | null = null;

const getTransporter = (): nodemailer.Transporter<SMTPTransport.SentMessageInfo> | null => {
  const { ZOHO_SMTP_USER, ZOHO_SMTP_PASS, ZOHO_SMTP_HOST, ZOHO_SMTP_PORT, ZOHO_SMTP_SECURE } = env;

  if (!ZOHO_SMTP_USER || !ZOHO_SMTP_PASS) {
    return null;
  }

  if (!transporter) {
    const port = Number(ZOHO_SMTP_PORT);
    transporter = nodemailer.createTransport({
      host: ZOHO_SMTP_HOST,
      port,
      secure: ZOHO_SMTP_SECURE === "true",
      auth: {
        user: ZOHO_SMTP_USER,
        pass: ZOHO_SMTP_PASS,
      },
    });
  }

  return transporter;
};

/**
 * Sends waitlist confirmation via Zoho Mail SMTP.
 * No-ops when Zoho SMTP credentials are unset (logs a warning).
 */
export const sendWaitlistConfirmationEmail = async (
  to: string,
  firstName?: string
): Promise<void> => {
  const transport = getTransporter();
  const from = env.ZOHO_MAIL_FROM;

  if (!transport || !from) {
    logger.warn("ZOHO_SMTP_USER, ZOHO_SMTP_PASS, or ZOHO_MAIL_FROM missing; skip waitlist email");
    return;
  }

  try {
    await transport.sendMail({
      from,
      to,
      subject: WAITLIST_EMAIL_SUBJECT,
      html: buildWaitlistEmailHtml(firstName),
    });
    logger.info("Waitlist confirmation email sent via Zoho", { to });
  } catch (err) {
    logger.error("Zoho SMTP error sending waitlist email", {
      to,
      message: err instanceof Error ? err.message : String(err),
    });
    // Never rethrow — callers must not surface email failures to the client
  }
};
