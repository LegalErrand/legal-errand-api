import { env } from "../../config/env";
import { logger } from "../../utils/logger";

const RESEND_API_URL = "https://api.resend.com/emails";

const waitlistEmailHtml = (greetingName: string): string => {
  const primary = "#D97706";
  const primaryLight = "#F59E0B";
  const accentGreen = "#00FF78";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:Georgia,'Times New Roman',serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f0f0f;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#1a1a1a;border-radius:12px;overflow:hidden;border:1px solid #2a2a2a;">
          <tr>
            <td style="padding:28px 28px 8px 28px;">
              <p style="margin:0;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:${accentGreen};">LegalErrand</p>
              <h1 style="margin:12px 0 0 0;font-size:24px;font-weight:600;color:#fafafa;line-height:1.3;">You&rsquo;re on the list</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px 28px;">
              <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#d4d4d4;">${greetingName}</p>
              <p style="margin:0 0 20px 0;font-size:15px;line-height:1.65;color:#a3a3a3;">
                Thanks for joining the LegalErrand waitlist. We&rsquo;ll email you when spots open and share product updates along the way.
              </p>
              <p style="margin:0;font-size:15px;line-height:1.65;color:#a3a3a3;">
                &mdash; The LegalErrand team
              </p>
            </td>
          </tr>
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,${primary} 0%,${primaryLight} 50%,${accentGreen} 100%);"></td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

/**
 * Sends a waitlist confirmation to the subscriber via Resend REST API.
 * No-ops when Resend env vars are unset (logs a warning).
 */
export const sendWaitlistConfirmationEmail = async (
  to: string,
  name?: string
): Promise<void> => {
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM;
  if (!apiKey || !from) {
    logger.warn("RESEND_API_KEY or RESEND_FROM missing; skip waitlist confirmation email");
    return;
  }

  const greetingName = name?.trim()
    ? `Hi ${name.trim()},`
    : "Hi there,";

  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "You're on the LegalErrand waitlist",
      html: waitlistEmailHtml(greetingName),
    }),
  });

  const bodyText = await res.text();
  if (!res.ok) {
    logger.error("Resend API error sending waitlist email", {
      status: res.status,
      body: bodyText.slice(0, 500),
    });
    return;
  }

  logger.info("Waitlist confirmation email sent", { to });
};
