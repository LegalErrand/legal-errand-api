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

  /** Passwordless sign-in link. */
  async sendFirmMagicLink(email: string, link: string): Promise<boolean> {
    const ok = await sendEmail({
      to: email,
      subject: "Your LegalErrand sign-in link",
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Sign in to LegalErrand</h2>
          <p style="color: #555; line-height: 1.5;">
            Use the button below to sign in without a password. It works once and expires in
            fifteen minutes.
          </p>
          <p style="text-align: center; margin: 28px 0;">
            <a href="${escapeHtml(link)}" style="background-color: #D97706; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; display: inline-block; font-weight: 600;">
              Sign in
            </a>
          </p>
          <p style="color: #777; font-size: 13px; line-height: 1.5;">
            If you did not ask for this, ignore this email — nobody can sign in without the link.
          </p>
        </div>`,
    });
    if (ok) {
      logger.info(`[EMAIL] Firm magic link sent to ${email}`);
    } else {
      logger.error(
        `[EMAIL] FAILED to send firm magic link to ${email} — check mail provider config`
      );
    }
    return ok;
  },

  /** Invitation to join a firm, at a role the inviter chose. */
  /** LE-028 — the one-time link a signer uses to open and sign a document. */
  async sendSignatureRequest(
    email: string,
    o: {
      signerName: string;
      firmName: string;
      requesterName: string;
      documentTitle: string;
      capacity: string;
      link: string;
      expiresOn: string;
    }
  ): Promise<boolean> {
    const ok = await sendEmail({
      to: email,
      subject: `${o.firmName} has sent you a document to sign: ${o.documentTitle}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">A document is waiting for your signature</h2>
          <p style="color: #555; line-height: 1.5;">
            ${escapeHtml(o.signerName)}, ${escapeHtml(o.requesterName)} of
            ${escapeHtml(o.firmName)} has asked you to sign
            <b>${escapeHtml(o.documentTitle)}</b> as <b>${escapeHtml(o.capacity)}</b>.
          </p>
          <p style="color: #555; line-height: 1.5;">
            You can read the document in full before you sign, and you may decline instead.
          </p>
          <p style="text-align: center; margin: 28px 0;">
            <a href="${escapeHtml(o.link)}" style="background-color: #D97706; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; display: inline-block; font-weight: 600;">
              Open the document
            </a>
          </p>
          <p style="color: #777; font-size: 13px; line-height: 1.5;">
            This link is for you alone, can only be used once, and stops working on
            ${escapeHtml(o.expiresOn)}. If you were not expecting it, do not use it — tell
            ${escapeHtml(o.firmName)} instead.
          </p>
        </div>`,
    });
    if (ok) {
      logger.info(`[EMAIL] Signature request sent to ${email}`);
    } else {
      logger.error(
        `[EMAIL] FAILED to send signature request to ${email} — check mail provider config`
      );
    }
    return ok;
  },

  /** LE-001 — a colleague is asking to be let into a firm on their domain. */
  async sendFirmJoinRequest(
    email: string,
    o: { firmName: string; requesterEmail: string; note?: string }
  ): Promise<boolean> {
    const ok = await sendEmail({
      to: email,
      subject: `${o.requesterEmail} is asking to join ${o.firmName} on LegalErrand`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Someone wants to join ${escapeHtml(o.firmName)}</h2>
          <p style="color: #555; line-height: 1.5;">
            <b>${escapeHtml(o.requesterEmail)}</b> signed up with an address on your firm's
            domain and asked to be let in rather than starting a second account.
          </p>
          ${
            o.note
              ? `<blockquote style="margin: 16px 0; padding: 10px 14px; border-left: 3px solid #D97706; color: #555; line-height: 1.5;">${escapeHtml(
                  o.note
                )}</blockquote>`
              : ""
          }
          <p style="color: #555; line-height: 1.5;">
            Approve it from <b>Team &rarr; Join requests</b>, choosing the role to admit them at.
            Nothing happens until you do.
          </p>
          <p style="color: #777; font-size: 13px; line-height: 1.5;">
            If you do not recognise this address, decline it. Declining tells them nothing.
          </p>
        </div>`,
    });
    if (ok) {
      logger.info(`[EMAIL] Join request notice sent to ${email}`);
    } else {
      logger.error(`[EMAIL] FAILED to send join request notice to ${email}`);
    }
    return ok;
  },

  /**
   * A LegalErrand admin is asking to look inside this firm's workspace.
   *
   * Written to be refusable: the decline is as prominent as the approve, and
   * it says plainly that nothing happens unless they act.
   */
  async sendFirmAccessRequest(
    email: string,
    o: { firmName: string; adminEmail: string; reason?: string; link: string; hours: number }
  ): Promise<boolean> {
    const ok = await sendEmail({
      to: email,
      subject: `Someone at LegalErrand is asking to see ${o.firmName}'s workspace`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">A support request needs your permission</h2>
          <p style="color: #555; line-height: 1.5;">
            <b>${escapeHtml(o.adminEmail)}</b> at LegalErrand is asking to open a read-only
            view of <b>${escapeHtml(o.firmName)}</b>'s workspace.
          </p>
          ${
            o.reason
              ? `<p style="color: #555; line-height: 1.5;">They gave this reason:</p>
                 <blockquote style="margin: 12px 0; padding: 10px 14px; border-left: 3px solid #9a5f12; color: #555; line-height: 1.5;">${escapeHtml(
                   o.reason
                 )}</blockquote>`
              : ""
          }
          <p style="color: #555; line-height: 1.5;">
            If you approve, they can read your workspace for <b>${o.hours} hours</b> and nothing
            longer. They will not be able to change, send or delete anything, and you can end it
            at any point from your firm settings.
          </p>
          <p style="text-align: center; margin: 28px 0;">
            <a href="${escapeHtml(o.link)}" style="background-color: #9a5f12; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; display: inline-block; font-weight: 600;">
              Review this request
            </a>
          </p>
          <p style="color: #777; font-size: 13px; line-height: 1.5;">
            <b>Nothing happens unless you approve it.</b> Declining is a normal answer and needs
            no explanation. If you were not expecting this, decline it and tell us.
          </p>
          <p style="color: #777; font-size: 13px; line-height: 1.5;">
            This link is for you alone and stops working in three days.
          </p>
        </div>`,
    });
    if (ok) {
      logger.info(`[EMAIL] Firm access request sent to ${email}`);
    } else {
      logger.error(`[EMAIL] FAILED to send firm access request to ${email}`);
    }
    return ok;
  },

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
