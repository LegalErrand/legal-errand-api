/**
 * Fills in Firm.domain for firms created before it existed.
 *
 * Without this, an existing firm is never offered to a colleague signing up on
 * its domain, and the join-request flow is inert for every firm already in the
 * database — which is all of them.
 *
 * The domain is taken from contactEmail, which is the address the firm was
 * created with. Free mailboxes are skipped: a firm whose contact address is a
 * gmail account does not own gmail.com, and claiming it would offer that firm
 * to every gmail signup.
 *
 * Idempotent, and prints what it would do before doing it:
 *   npx ts-node --transpile-only src/scripts/backfillFirmDomains.ts         # dry run
 *   npx ts-node --transpile-only src/scripts/backfillFirmDomains.ts --apply
 */
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { Firm } from "../models/firm";

const PUBLIC_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "live.com",
  "aol.com",
];

function loadEnv(): void {
  const envPath = path.resolve(__dirname, "../../.env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

(async () => {
  loadEnv();
  const apply = process.argv.includes("--apply");
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("No MONGODB_URI in the environment.");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const firms = await Firm.find({ domain: { $exists: false } }).select("name contactEmail");

  let set = 0;
  let skipped = 0;
  const claimed = new Map<string, string>();

  for (const firm of firms) {
    const domain = String(firm.contactEmail ?? "")
      .toLowerCase()
      .trim()
      .split("@")[1];

    if (!domain || PUBLIC_EMAIL_DOMAINS.includes(domain)) {
      console.log(
        `skip  ${firm.name} — contact address is ${domain ? "a free mailbox" : "unusable"}`
      );
      skipped++;
      continue;
    }

    // Two firms on one domain is exactly the situation this feature exists to
    // prevent, so it is reported rather than resolved by guessing.
    const existing = await Firm.findOne({ domain }).select("name");
    const alreadyClaimed = claimed.get(domain);
    if (existing || alreadyClaimed) {
      console.log(
        `CLASH ${firm.name} — ${domain} already belongs to ${existing?.name ?? alreadyClaimed}. Left unset; decide by hand.`
      );
      skipped++;
      continue;
    }

    console.log(`${apply ? "set  " : "would"} ${firm.name} -> ${domain}`);
    claimed.set(domain, firm.name);
    if (apply) await Firm.updateOne({ _id: firm._id }, { $set: { domain } });
    set++;
  }

  console.log(
    `\n${firms.length} firm(s) without a domain. ${apply ? "Set" : "Would set"} ${set}, skipped ${skipped}.`
  );
  if (!apply && set > 0) console.log("Re-run with --apply to write them.");

  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
