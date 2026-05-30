import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";

let transporter: nodemailer.Transporter<SMTPTransport.SentMessageInfo> | null = null;

export const getZeptoTransporter =
  (): nodemailer.Transporter<SMTPTransport.SentMessageInfo> | null => {
    const {
      ZEPTO_SMTP_USER,
      ZEPTO_SMTP_PASS,
      ZEPTO_SMTP_HOST,
      ZEPTO_SMTP_PORT,
      ZEPTO_SMTP_SECURE,
    } = env;

    if (!ZEPTO_SMTP_PASS) {
      return null;
    }

    if (!transporter) {
      transporter = nodemailer.createTransport({
        host: ZEPTO_SMTP_HOST,
        port: Number(ZEPTO_SMTP_PORT),
        secure: ZEPTO_SMTP_SECURE === "true",
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
        auth: {
          user: ZEPTO_SMTP_USER,
          pass: ZEPTO_SMTP_PASS,
        },
      });
    }

    return transporter;
  };

export const sendZeptoMail = async (options: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}): Promise<boolean> => {
  const transport = getZeptoTransporter();
  const from = options.from ?? env.ZEPTO_MAIL_FROM;

  if (!transport || !from) {
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
    logger.error("ZeptoMail SMTP send failed", {
      to: options.to,
      subject: options.subject,
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
};
