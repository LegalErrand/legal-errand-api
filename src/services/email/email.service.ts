import { logger } from "../../utils/logger";
import { sendEmail } from "./mail-delivery";

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
        `[EMAIL] FAILED to send password reset OTP to ${email} — check Zepto/Zoho/Resend config`
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
        `[EMAIL] FAILED to send verification OTP to ${email} — check Zepto/Zoho/Resend config`
      );
    }
    return ok;
  },
};
