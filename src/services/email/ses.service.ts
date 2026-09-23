import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";

let sesClient: SESClient | null = null;

function getClient(): SESClient {
  if (!sesClient) {
    sesClient = new SESClient({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return sesClient;
}

export const isSesConfigured = (): boolean =>
  Boolean(env.AWS_SES_FROM_EMAIL && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);

export const sendSesMail = async (options: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> => {
  if (!isSesConfigured()) return false;

  try {
    await getClient().send(
      new SendEmailCommand({
        Source: env.AWS_SES_FROM_EMAIL!,
        Destination: { ToAddresses: [options.to] },
        Message: {
          Subject: { Data: options.subject, Charset: "UTF-8" },
          Body: { Html: { Data: options.html, Charset: "UTF-8" } },
        },
      })
    );
    return true;
  } catch (err) {
    logger.error("AWS SES send failed", {
      to: options.to,
      subject: options.subject,
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
};
