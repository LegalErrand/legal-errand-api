import { env } from "../../config/env";
import { logger } from "../../utils/logger";

export const sendResendMail = async (options: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}): Promise<boolean> => {
  const apiKey = env.RESEND_API_KEY;
  const from = options.from ?? env.RESEND_FROM;

  if (!apiKey) {
    logger.warn("Resend not configured (RESEND_API_KEY missing)");
    return false;
  }

  if (!from) {
    logger.warn("Resend from address missing (RESEND_FROM or from option required)");
    return false;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [options.to],
        subject: options.subject,
        html: options.html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error("Resend API error", {
        status: response.status,
        body,
        to: options.to,
        subject: options.subject,
      });
      return false;
    }

    return true;
  } catch (err) {
    logger.error("Resend send failed", {
      to: options.to,
      subject: options.subject,
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
};
