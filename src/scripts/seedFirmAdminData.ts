/**
 * Sample billing, support and activity data for the firm admin dashboard.
 *
 * Development only. It invents invoices, payments, tickets and activity rows so
 * the firm-admin screens have something to draw; none of it is real, and it
 * should never be pointed at production.
 *
 * Usage:
 *   npx ts-node --transpile-only src/scripts/seedFirmAdminData.ts
 *   npx ts-node --transpile-only src/scripts/seedFirmAdminData.ts --reset
 */
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import {
  Firm,
  FirmMember,
  Invoice,
  Payment,
  SupportTicket,
  FirmActivityLog,
  Subscription,
  ActivityType,
  TicketPriority,
  TicketStatus,
  TicketTeam,
} from "../models/firm";
import { listPriceFor, FirmPlan } from "../config/plans";

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

const DAY_MS = 86_400_000;

/** Seeded so a re-run produces the same story rather than a different one. */
let seed = 20260928;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
const rint = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));

/**
 * Activity summaries. Reference numbers only — never a client's name and never
 * anything a document said. See the boundary note on FirmActivityLog.
 */
const ACTIVITY: { type: ActivityType; say: () => string }[] = [
  {
    type: "signin",
    say: () =>
      `signed in from ${pick(["Chrome on Windows", "Safari on iPhone", "Chrome on macOS", "Edge on Windows"])}`,
  },
  { type: "matter", say: () => `opened matter M-${rint(1000, 1899)}` },
  { type: "matter", say: () => `moved matter M-${rint(1000, 1899)} to discovery` },
  { type: "document", say: () => `created a document from a template` },
  { type: "document", say: () => `exported D-${rint(3000, 3899)} to Word` },
  { type: "document", say: () => `sent D-${rint(3000, 3899)} for sign-off` },
  { type: "ai", say: () => `asked the AI assistant a question` },
  { type: "ai", say: () => `generated a first draft` },
  {
    type: "research",
    say: () =>
      `researched a question (${pick(["Lagos State", "Nigeria — national", "England and Wales"])})`,
  },
  { type: "client", say: () => `accepted a new client from the intake form` },
  { type: "client", say: () => `shared a document to the client portal` },
  { type: "calendar", say: () => `scheduled a hearing` },
  { type: "calendar", say: () => `added a filing deadline` },
  { type: "billing", say: () => `approved ${rint(2, 8)} time entries` },
  { type: "settings", say: () => `invited a new lawyer` },
  { type: "security", say: () => `turned on two-factor sign-in` },
];

const FAILED_SIGNIN = {
  type: "security" as ActivityType,
  say: () => "had a failed sign-in attempt",
};

const CITIES = ["Ikeja", "Victoria Island", "Lekki", "Wuse", "Port Harcourt"];

const TICKETS: {
  subject: string;
  priority: TicketPriority;
  status: TicketStatus;
  team: TicketTeam;
}[] = [
  {
    subject: "Card declined on renewal — Paystack",
    priority: "urgent",
    status: "open",
    team: "billing",
  },
  { subject: "Cannot add another lawyer", priority: "high", status: "open", team: "sales" },
  {
    subject: "Word file with tracked changes opens without them",
    priority: "high",
    status: "in_progress",
    team: "product",
  },
  {
    subject: "Client portal link expired for a client",
    priority: "normal",
    status: "open",
    team: "support",
  },
  {
    subject: "Import 240 matters from Excel",
    priority: "normal",
    status: "in_progress",
    team: "onboarding",
  },
  { subject: "Invoice shows VAT twice", priority: "normal", status: "resolved", team: "billing" },
  {
    subject: "Research cited a case we could not find",
    priority: "high",
    status: "resolved",
    team: "ai_quality",
  },
];

async function main(): Promise<void> {
  loadEnv();
  const reset = process.argv.includes("--reset");
  const uri = process.env.MONGO_URI ?? "mongodb://localhost:27017/legalerrand";

  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to run: this seeds invented data and NODE_ENV is production.");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("Connected to MongoDB");

  if (reset) {
    const removed = await Promise.all([
      Invoice.deleteMany({}),
      Payment.deleteMany({}),
      SupportTicket.deleteMany({}),
      FirmActivityLog.deleteMany({}),
    ]);
    console.log(
      `Cleared ${removed.map((r) => r.deletedCount).join(", ")} invoices, payments, tickets, activity rows`
    );
  }

  const firms = await Firm.find();
  console.log(`${firms.length} firms`);

  let invoiceNumber = 20400;
  let ticketNumber = 1030;

  for (const firm of firms) {
    const subscription = await Subscription.findOne({ firmId: firm._id });
    const members = await FirmMember.find({ firmId: firm._id }).select("_id name");
    if (!members.length) {
      console.log(`  ${firm.name}: no members, skipping`);
      continue;
    }

    // ── Invoices, one a month, oldest first ──────────────────────────────────
    const plan = (subscription?.plan ?? "practice") as FirmPlan;

    // Enterprise has no list price, so a firm on it with nothing agreed would be
    // invoiced for an amount its own MRR says is zero. Settle a figure on the
    // subscription first, so the money on the invoices and the money in the
    // metrics are the same money.
    if (subscription && !subscription.mrr && subscription.status !== "trialing") {
      subscription.mrr = listPriceFor(plan) || rint(4, 9) * 50_000;
      await subscription.save();
      console.log(
        `  ${firm.name}: agreed price set to ₦${subscription.mrr.toLocaleString("en-GB")}/mo`
      );
    }

    const amount = subscription?.mrr || listPriceFor(plan) || 50_000;
    const months = 6;
    let invoicesMade = 0;

    if (!(await Invoice.countDocuments({ firmId: firm._id }))) {
      for (let back = months - 1; back >= 0; back--) {
        const issuedAt = new Date(Date.now() - (back * 30 + 3) * DAY_MS);
        // The most recent one fails for a firm that is past_due, so the retry
        // and at-risk paths have something real to act on.
        const failed = back === 0 && subscription?.status === "past_due";
        const invoice = await Invoice.create({
          firmId: firm._id,
          number: `LE-${invoiceNumber++}`,
          amount,
          status: failed ? "failed" : "paid",
          plan,
          periodStart: issuedAt,
          periodEnd: new Date(issuedAt.getTime() + 30 * DAY_MS),
          issuedAt,
          paidAt: failed ? undefined : new Date(issuedAt.getTime() + rint(0, 2) * DAY_MS),
        });
        await Payment.create({
          invoiceId: invoice._id,
          firmId: firm._id,
          provider: "paystack",
          providerRef: `seed_${invoice.number}`,
          method: pick(["Card", "Transfer", "USSD"]),
          amount,
          status: failed ? "failed" : "succeeded",
          attempt: 1,
          failureReason: failed ? "Insufficient funds" : undefined,
          attemptedAt: issuedAt,
        });
        invoicesMade++;
      }
    }

    // ── Activity, spread over the last 30 days ───────────────────────────────
    let activityMade = 0;
    if (!(await FirmActivityLog.countDocuments({ firmId: firm._id }))) {
      const rows = 40 + members.length * 20;
      for (let i = 0; i < rows; i++) {
        const member = pick(members);
        const entry = rand() < 0.03 ? FAILED_SIGNIN : pick(ACTIVITY);
        const at = new Date(Date.now() - rand() * 30 * DAY_MS);
        await FirmActivityLog.create({
          firmId: firm._id,
          memberId: member._id,
          type: entry.type,
          summary: entry.say(),
          city: pick(CITIES),
          ipPrefix: `${pick(["102", "105", "197", "41"])}.${rint(0, 255)}.x.x`,
          suspicious: entry === FAILED_SIGNIN,
          at,
        });
        activityMade++;
      }
    }

    // ── A couple of tickets each ─────────────────────────────────────────────
    let ticketsMade = 0;
    if (!(await SupportTicket.countDocuments({ firmId: firm._id }))) {
      const chosen = [...TICKETS.slice(0, rint(2, 3)), TICKETS[TICKETS.length - 1]];
      for (const template of chosen) {
        const openedAt = new Date(Date.now() - rint(1, 14) * DAY_MS);
        await SupportTicket.create({
          reference: `T-${ticketNumber++}`,
          firmId: firm._id,
          subject: template.subject,
          priority: template.priority,
          status: template.status,
          team: template.team,
          openedAt,
          firstRepliedAt: new Date(openedAt.getTime() + rint(10, 90) * 60_000),
          resolvedAt:
            template.status === "resolved"
              ? new Date(openedAt.getTime() + rint(2, 20) * 3_600_000)
              : undefined,
        });
        ticketsMade++;
      }
    }

    console.log(
      `  ${firm.name}: ${invoicesMade} invoices, ${activityMade} activity rows, ${ticketsMade} tickets`
    );
  }

  console.log("\nDone. This is sample data — none of it is real.");
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
