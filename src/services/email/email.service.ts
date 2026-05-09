import { Resend } from "resend";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";

const resend = new Resend(env.RESEND_API_KEY);

export const emailService = {
  /**
   * Send a password reset OTP using Resend.
   * 
   * @param email The recipient email address
   * @param otp The 6-digit OTP
   */
  async sendPasswordResetOtp(email: string, otp: string): Promise<void> {
    try {
      const { data, error } = await resend.emails.send({
        // Using verified domain legalerrand.com
        from: "LegalErrand Support <noreply@legalerrand.com>",
        to: email,
        subject: "Your LegalErrand Password Reset OTP",
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">Password Reset Request</h2>
            <p style="color: #555; line-height: 1.5;">You requested a password reset for your LegalErrand account.</p>
            <p style="color: #555; line-height: 1.5;">Your one-time password (OTP) is:</p>
            <div style="background-color: #f4f4f4; border-radius: 8px; padding: 15px; text-align: center; margin: 20px 0;">
              <h1 style="color: #4A90E2; letter-spacing: 5px; margin: 0;">${otp}</h1>
            </div>
            <p style="color: #555; line-height: 1.5;">This code expires in 10 minutes. If you did not request a password reset, you can safely ignore this email.</p>
          </div>
        `,
      });

      if (error) {
        logger.error(`❌ Failed to send OTP to ${email} via Resend:`, error);
      } else {
        logger.info(`✅ Resend OTP email sent to ${email} (ID: ${data?.id})`);
      }
    } catch (err) {
      logger.error(`❌ Unexpected error sending email via Resend:`, err);
    }
  },

  /**
   * Send an account verification OTP using Resend.
   * 
   * @param email The recipient email address
   * @param otp The 6-digit OTP
   */
  async sendVerificationOtp(email: string, otp: string): Promise<void> {
    try {
      const { data, error } = await resend.emails.send({
        from: "LegalErrand Support <noreply@legalerrand.com>",
        to: email,
        subject: "Verify Your LegalErrand Account",
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">Account Verification</h2>
            <p style="color: #555; line-height: 1.5;">Welcome to LegalErrand! Please use the following code to verify your school email address.</p>
            <div style="background-color: #f4f4f4; border-radius: 8px; padding: 15px; text-align: center; margin: 20px 0;">
              <h1 style="color: #4A90E2; letter-spacing: 5px; margin: 0;">${otp}</h1>
            </div>
            <p style="color: #555; line-height: 1.5;">This code expires in 15 minutes.</p>
          </div>
        `,
      });

      if (error) {
        logger.error(`❌ Failed to send verification OTP to ${email} via Resend:`, error);
      } else {
        logger.info(`✅ Resend Verification OTP email sent to ${email} (ID: ${data?.id})`);
      }
    } catch (err) {
      logger.error(`❌ Unexpected error sending verification email via Resend:`, err);
    }
  }
};
