/**
 * Test ZeptoMail, Zoho SMTP, and Resend independently.
 * Usage: npx ts-node --transpile-only src/scripts/test-email-providers.ts [recipient@email.com]
 */
import { config } from "dotenv";
import path from "path";
import net from "net";

config({ path: path.resolve(__dirname, "../../.env") });

import { env } from "../config/env";
import { sendResendMail } from "../services/email/resend.service";
import { sendZeptoApiMail, isZeptoApiConfigured } from "../services/email/zepto-api.service";
import { sendZeptoMail } from "../services/email/zepto-transport";
import { sendZohoMail } from "../services/email/zoho-transport";

const to = (process.argv[2] ?? "admin@legalerrand.com").trim();
const now = new Date().toISOString();

type Result = "ok" | "fail" | "skip";

const testHtml = (provider: string) =>
  `<p>LegalErrand provider test: <strong>${provider}</strong></p><p>Sent at ${now}</p>`;

async function probeSmtp(host: string, port: number, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.on("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function runProvider(
  name: string,
  configured: boolean,
  send: () => Promise<boolean>
): Promise<{ name: string; configured: boolean; result: Result; ms: number; detail?: string }> {
  if (!configured) {
    return { name, configured: false, result: "skip", ms: 0, detail: "env vars not set" };
  }

  const start = Date.now();
  try {
    const ok = await send();
    const ms = Date.now() - start;
    return {
      name,
      configured: true,
      result: ok ? "ok" : "fail",
      ms,
      detail: ok ? "send succeeded" : "send returned false (check server logs above)",
    };
  } catch (err) {
    return {
      name,
      configured: true,
      result: "fail",
      ms: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  console.log("\n=== Email provider test (local) ===\n");
  console.log(`Recipient: ${to}\n`);

  const zeptoConfigured = Boolean(env.ZEPTO_SMTP_PASS && env.ZEPTO_MAIL_FROM);
  const zohoConfigured = Boolean(env.ZOHO_SMTP_USER && env.ZOHO_SMTP_PASS && env.ZOHO_MAIL_FROM);
  const resendConfigured = Boolean(env.RESEND_API_KEY && env.RESEND_FROM);

  const zeptoApiConfigured = isZeptoApiConfigured();

  console.log("Configuration (values hidden):");
  console.log(
    `  ZeptoMail SMTP: ${zeptoConfigured ? "yes" : "no"} (host ${env.ZEPTO_SMTP_HOST}:${env.ZEPTO_SMTP_PORT})`
  );
  console.log(`  ZeptoMail API:  ${zeptoApiConfigured ? "yes" : "no"}`);
  console.log(
    `  Zoho SMTP:      ${zohoConfigured ? "yes" : "no"} (host ${env.ZOHO_SMTP_HOST}:${env.ZOHO_SMTP_PORT})`
  );
  console.log(`  Resend API:     ${resendConfigured ? "yes" : "no"}\n`);

  console.log("SMTP port reachability (TCP, 8s timeout):");
  if (zeptoConfigured) {
    const zeptoReachable = await probeSmtp(env.ZEPTO_SMTP_HOST, Number(env.ZEPTO_SMTP_PORT));
    console.log(
      `  ${env.ZEPTO_SMTP_HOST}:${env.ZEPTO_SMTP_PORT} → ${zeptoReachable ? "REACHABLE" : "TIMEOUT/BLOCKED"}`
    );
  }
  if (zohoConfigured) {
    const zohoReachable = await probeSmtp(env.ZOHO_SMTP_HOST, Number(env.ZOHO_SMTP_PORT));
    console.log(
      `  ${env.ZOHO_SMTP_HOST}:${env.ZOHO_SMTP_PORT} → ${zohoReachable ? "REACHABLE" : "TIMEOUT/BLOCKED"}`
    );
  }
  console.log("  api.resend.com:443 → HTTPS (not probed; send test below)\n");

  console.log("Sending one test email per configured provider...\n");

  const results = await Promise.all([
    runProvider("ZeptoMail SMTP", zeptoConfigured, () =>
      sendZeptoMail({
        to,
        subject: `[Test] ZeptoMail SMTP — ${now}`,
        html: testHtml("ZeptoMail SMTP"),
        from: env.ZEPTO_MAIL_FROM!,
      })
    ),
    runProvider("Zoho SMTP", zohoConfigured, () =>
      sendZohoMail({
        to,
        subject: `[Test] Zoho SMTP — ${now}`,
        html: testHtml("Zoho SMTP"),
        from: env.ZOHO_MAIL_FROM!,
      })
    ),
    runProvider("ZeptoMail API", zeptoApiConfigured, () =>
      sendZeptoApiMail({
        to,
        subject: `[Test] ZeptoMail API — ${now}`,
        html: testHtml("ZeptoMail API"),
        from: env.ZEPTO_MAIL_FROM!,
      })
    ),
    runProvider("Resend API", resendConfigured, () =>
      sendResendMail({
        to,
        subject: `[Test] Resend API — ${now}`,
        html: testHtml("Resend API"),
        from: env.RESEND_FROM!,
      })
    ),
  ]);

  console.log("Results:");
  for (const r of results) {
    const icon = r.result === "ok" ? "✅" : r.result === "skip" ? "⏭️" : "❌";
    const timing = r.result === "skip" ? "" : ` (${r.ms}ms)`;
    console.log(`  ${icon} ${r.name}${timing} — ${r.detail ?? r.result}`);
  }

  console.log("\nCheck the inbox (and spam) for up to 3 test messages.\n");

  const anyFailed = results.some((r) => r.result === "fail");
  const anyOk = results.some((r) => r.result === "ok");
  if (!anyOk && !results.some((r) => r.result === "skip")) {
    process.exit(1);
  }
  if (anyFailed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
