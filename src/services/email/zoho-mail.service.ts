import { logger } from "../../utils/logger";
import { sendEmail } from "./mail-delivery";
import { WAITLIST_EMAIL_SUBJECT, buildWaitlistEmailHtml } from "./waitlist-email.template";

/**
 * Sends waitlist confirmation (ZeptoMail → Zoho → Resend).
 * Never rethrows — callers must not surface email failures to the client.
 */
export const sendWaitlistConfirmationEmail = async (
  to: string,
  firstName?: string
): Promise<void> => {
  const ok = await sendEmail({
    to,
    subject: WAITLIST_EMAIL_SUBJECT,
    html: buildWaitlistEmailHtml(firstName),
  });

  if (ok) {
    logger.info("Waitlist confirmation email sent", { to });
  }
};
