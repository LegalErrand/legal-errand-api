import { logger } from "../../utils/logger";
import { sendEmail } from "./mail-delivery";
import { buildWaitlistEmailHtml, WAITLIST_EMAIL_SUBJECT } from "./waitlist-email.template";

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const otpEmailHtml = (title: string, body: string, otp: string): string => `
  <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #333;">${title}</h2>
    <p style="color: #555; line-height: 1.5;">${body}</p>
    <div style="background-color: #f4f4f4; border-radius: 8px; padding: 15px; text-align: center; margin: 20px 0;">
      <h1 style="color: #D97706; letter-spacing: 5px; margin: 0;">${escapeHtml(otp)}</h1>
    </div>
  </div>`;

export const emailService = {
  async sendPasswordResetOtp(email: string, otp: string): Promise<boolean> {
    const ok = await sendEmail({
      to: email,
      subject: "Your LegalErrand Password Reset OTP",
      html:
        otpEmailHtml(
          "Password Reset Request",
          "You requested a password reset for your LegalErrand account. Your one-time password (OTP) is:",
          otp
        ) +
        `<p style="color: #555; line-height: 1.5; font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 0 20px 20px;">
          This code expires in 10 minutes. If you did not request a password reset, you can safely ignore this email.
        </p>`,
    });
    if (ok) {
      logger.info(`[EMAIL] Password reset OTP sent to ${email}`);
    } else {
      logger.error(
        `[EMAIL] FAILED to send password reset OTP to ${email} — check mail provider config`
      );
    }
    return ok;
  },

  async sendVerificationOtp(email: string, otp: string): Promise<boolean> {
    const ok = await sendEmail({
      to: email,
      subject: "Verify Your LegalErrand Account",
      html:
        otpEmailHtml(
          "Account Verification",
          "Welcome to LegalErrand! Please use the following code to verify your school email address:",
          otp
        ) +
        `<p style="color: #555; line-height: 1.5; font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 0 20px 20px;">
          This code expires in 15 minutes.
        </p>`,
    });
    if (ok) {
      logger.info(`[EMAIL] Verification OTP sent to ${email}`);
    } else {
      logger.error(
        `[EMAIL] FAILED to send verification OTP to ${email} — check mail provider config`
      );
    }
    return ok;
  },

  /** The one-time code a firm member needs after their password is accepted. */
  async sendFirmLoginOtp(email: string, otp: string): Promise<boolean> {
    const ok = await sendEmail({
      to: email,
      subject: "Your LegalErrand sign-in code",
      html:
        otpEmailHtml(
          "Sign-in code",
          "Someone signed in to your LegalErrand firm workspace with your password. Enter this code to finish:",
          otp
        ) +
        `<p style="color: #555; line-height: 1.5; font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 0 20px 20px;">
          This code expires in 10 minutes. If this was not you, change your password — someone else knows it.
        </p>`,
    });
    if (ok) {
      logger.info(`[EMAIL] Firm login OTP sent to ${email}`);
    } else {
      logger.error(
        `[EMAIL] FAILED to send firm login OTP to ${email} — check mail provider config`
      );
    }
    return ok;
  },

  /** Invitation to join a firm, at a role the inviter chose. */
  async sendFirmInvitation(
    email: string,
    o: { firmName: string; inviterName: string; role: string; link: string }
  ): Promise<boolean> {
    const role = escapeHtml(o.role.replace(/_/g, " "));
    const ok = await sendEmail({
      to: email,
      subject: `${o.inviterName} invited you to join ${o.firmName} on LegalErrand`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">${escapeHtml(o.inviterName)} invited you to join ${escapeHtml(o.firmName)}</h2>
          <p style="color: #555; line-height: 1.5;">
            You have been invited as a <b>${role}</b>. Accept below to set your password and
            open your first matter.
          </p>
          <p style="text-align: center; margin: 28px 0;">
            <a href="${escapeHtml(o.link)}" style="background-color: #D97706; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; display: inline-block; font-weight: 600;">
              Accept the invitation
            </a>
          </p>
          <p style="color: #777; font-size: 13px; line-height: 1.5;">
            This invitation lasts seven days and can only be used once. If you were not expecting
            it, you can ignore this email.
          </p>
        </div>`,
    });
    if (ok) {
      logger.info(`[EMAIL] Firm invitation sent to ${email}`);
    } else {
      logger.error(
        `[EMAIL] FAILED to send firm invitation to ${email} — check mail provider config`
      );
    }
    return ok;
  },

  /** Single-use password reset link for the firm workspace. */
  async sendFirmPasswordResetLink(email: string, link: string): Promise<boolean> {
    const ok = await sendEmail({
      to: email,
      subject: "Reset your LegalErrand password",
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Reset your password</h2>
          <p style="color: #555; line-height: 1.5;">
            Someone asked to reset the password on your LegalErrand firm workspace. Use the button
            below within the hour. It can only be used once.
          </p>
          <p style="text-align: center; margin: 28px 0;">
            <a href="${escapeHtml(link)}" style="background-color: #D97706; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; display: inline-block; font-weight: 600;">
              Set a new password
            </a>
          </p>
          <p style="color: #777; font-size: 13px; line-height: 1.5;">
            If you did not ask for this, you can ignore this email — your password stays as it is.
          </p>
        </div>`,
    });
    if (ok) {
      logger.info(`[EMAIL] Firm password reset link sent to ${email}`);
    } else {
      logger.error(
        `[EMAIL] FAILED to send firm password reset link to ${email} — check mail provider config`
      );
    }
    return ok;
  },
};

export async function sendWaitlistConfirmationEmail(
  email: string,
  firstName?: string
): Promise<boolean> {
  const ok = await sendEmail({
    to: email,
    subject: WAITLIST_EMAIL_SUBJECT,
    html: buildWaitlistEmailHtml(firstName),
  });
  if (ok) {
    logger.info(`[EMAIL] Waitlist confirmation sent to ${email}`);
  } else {
    logger.error(
      `[EMAIL] FAILED to send waitlist confirmation to ${email} — check mail provider config`
    );
  }
  return ok;
}
