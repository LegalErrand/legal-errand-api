import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";

let transporter: nodemailer.Transporter<SMTPTransport.SentMessageInfo> | null = null;

export const getZohoTransporter =
  (): nodemailer.Transporter<SMTPTransport.SentMessageInfo> | null => {
    const { ZOHO_SMTP_USER, ZOHO_SMTP_PASS, ZOHO_SMTP_HOST, ZOHO_SMTP_PORT, ZOHO_SMTP_SECURE } =
      env;

    if (!ZOHO_SMTP_USER || !ZOHO_SMTP_PASS) {
      return null;
    }

    if (!transporter) {
      transporter = nodemailer.createTransport({
        host: ZOHO_SMTP_HOST,
        port: Number(ZOHO_SMTP_PORT),
        secure: ZOHO_SMTP_SECURE === "true",
        auth: {
          user: ZOHO_SMTP_USER,
          pass: ZOHO_SMTP_PASS,
        },
      });
    }

    return transporter;
  };

export const sendZohoMail = async (options: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}): Promise<boolean> => {
  const transport = getZohoTransporter();
  const from = options.from ?? env.ZOHO_MAIL_FROM;

  if (!transport || !from) {
    logger.warn(
      "Zoho SMTP not configured (ZOHO_SMTP_USER, ZOHO_SMTP_PASS, or ZOHO_MAIL_FROM missing)"
    );
    return false;
  }

  try {
    await transport.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
    return true;
  } catch (err) {
    logger.error("Zoho SMTP send failed", {
      to: options.to,
      subject: options.subject,
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
};
