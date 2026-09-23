import { env } from "../../config/env";
import { logger } from "../../utils/logger";

export const isBrevoConfigured = (): boolean => Boolean(env.BREVO_API_KEY && env.BREVO_MAIL_FROM);

/** Parse `"Name" <email@domain.com>` or bare `email@domain.com` */
function parseFromHeader(from: string): { email: string; name?: string } {
  const angle = from.match(/^(.+?)\s*<([^>]+)>$/);
  if (angle) {
    const name = angle[1].replace(/^["']|["']$/g, "").trim();
    return { name: name || undefined, email: angle[2].trim() };
  }
  return { email: from.trim() };
}

export const sendBrevoMail = async (options: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}): Promise<boolean> => {
  if (!env.BREVO_API_KEY || !env.BREVO_MAIL_FROM) return false;

  const sender = parseFromHeader(options.from ?? env.BREVO_MAIL_FROM);

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "api-key": env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender,
        to: [{ email: options.to }],
        subject: options.subject,
        htmlContent: options.html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error("Brevo API error", {
        status: response.status,
        body,
        to: options.to,
        subject: options.subject,
      });
      return false;
    }

    return true;
  } catch (err) {
    logger.error("Brevo API send failed", {
      to: options.to,
      subject: options.subject,
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
};
