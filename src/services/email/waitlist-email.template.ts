const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const WAITLIST_EMAIL_SUBJECT = "Your Spot is Secured.";

export const buildWaitlistEmailHtml = (firstName?: string): string => {
  const primary = "#D97706";
  const primaryLight = "#F59E0B";
  const accentGreen = "#00FF78";
  const firstEscaped = firstName?.trim() ? escapeHtml(firstName.trim()) : null;
  const helloLine = firstEscaped ? `Hello ${firstEscaped},` : "Hello there,";

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
              <p style="margin:0;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:${accentGreen};">LegalErrand Academy</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px 28px;">
              <p style="margin:0 0 20px 0;font-size:17px;line-height:1.55;color:#fafafa;">${helloLine}</p>
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#a3a3a3;">
                Your spot in LegalErrand Academy is confirmed. You just joined a group of law students who decided to study smarter.
              </p>
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#a3a3a3;">
                LegalErrand Academy is an AI-Native study platform built specifically for law students, and it&rsquo;s launching soon.
              </p>
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#a3a3a3;">
                As a founding member you&rsquo;ll be part of our beta testing group, getting access before anyone else to test the platform and help shape what it becomes.
              </p>
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#a3a3a3;">
                We&rsquo;ll also keep you updated on every step of the way, every feature we ship, every milestone we hit.
              </p>
              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.65;color:#a3a3a3;">
                You&rsquo;ll watch LegalErrand Academy come to life.
              </p>
              <p style="margin:0;font-size:15px;line-height:1.65;color:#d4d4d4;">
                &mdash; The LegalErrand Team
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
