import { env } from "../../config/env";
import { logger } from "../../utils/logger";

/** Parse `"Name" <email@domain.com>` or `email@domain.com` */
function parseFromHeader(from: string): { address: string; name?: string } {
  const angle = from.match(/^(.+?)\s*<([^>]+)>$/);
  if (angle) {
    const name = angle[1].replace(/^["']|["']$/g, "").trim();
    return { name: name || undefined, address: angle[2].trim() };
  }
  return { address: from.trim() };
}

/** ZeptoMail send-mail token (same value as ZEPTO_SMTP_PASS in the Agent SMTP/API tab). */
const zeptoApiToken = (): string | undefined => env.ZEPTO_SMTP_PASS;

export const isZeptoApiConfigured = (): boolean => Boolean(zeptoApiToken() && env.ZEPTO_MAIL_FROM);

export const sendZeptoApiMail = async (options: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}): Promise<boolean> => {
  const token = zeptoApiToken();
  const fromHeader = options.from ?? env.ZEPTO_MAIL_FROM;

  if (!token || !fromHeader) {
    return false;
  }

  const from = parseFromHeader(fromHeader);

  try {
    const response = await fetch("https://api.zeptomail.com/v1.1/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Zoho-enczapikey ${token}`,
      },
      body: JSON.stringify({
        from: { address: from.address, ...(from.name && { name: from.name }) },
        to: [{ email_address: { address: options.to } }],
        subject: options.subject,
        htmlbody: options.html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error("ZeptoMail API error", {
        status: response.status,
        body,
        to: options.to,
        subject: options.subject,
      });
      return false;
    }

    return true;
  } catch (err) {
    logger.error("ZeptoMail API send failed", {
      to: options.to,
      subject: options.subject,
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
};
