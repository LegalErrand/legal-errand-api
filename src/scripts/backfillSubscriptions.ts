/**
 * Gives every firm that has no subscription one, and fills in the structured
 * country/state the firm admin filters and groups by.
 *
 * Safe to run more than once: a firm that already has a subscription is left
 * exactly as it is, and a firm that already has a country keeps it.
 *
 * Usage:
 *   npx ts-node --transpile-only src/scripts/backfillSubscriptions.ts
 *   npx ts-node --transpile-only src/scripts/backfillSubscriptions.ts --dry-run
 */
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { Firm, FirmMember, Subscription } from "../models/firm";
import { FirmPlan, listPriceFor, seatsFor } from "../config/plans";

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

/**
 * `jurisdiction` is free text along the lines of
 * "Nigeria (Lagos State High Court)". Pull a country and a state out of it where
 * the shape allows, and leave the state unset rather than guess when it does not.
 */
export function placeFromJurisdiction(jurisdiction?: string): {
  country: string;
  state?: string;
} {
  if (!jurisdiction) return { country: "Nigeria" };

  const country = jurisdiction.split("(")[0].trim() || "Nigeria";
  const inBrackets = jurisdiction.match(/\(([^)]+)\)/)?.[1];
  if (!inBrackets) return { country };

  // "Lagos State High Court" → "Lagos"; "Federal Capital Territory" stays whole.
  const state = inBrackets
    .replace(/\b(High|Magistrate'?s?|Federal|Sharia|Customary|Appeal)?\s*Court(s)?\b/gi, "")
    .replace(/\bState\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return state ? { country, state } : { country };
}

/** The plan a firm's old subscriptionPlan maps on to in the new catalogue. */
function planFromLegacy(legacy: string, seatsInUse: number): FirmPlan {
  if (legacy === "starter") return "starter";
  if (legacy === "enterprise") return "enterprise";
  // "professional" covered both Practice and Firm. Seats in use decide which,
  // and a firm already past Practice's five should not be put back on it.
  return seatsInUse > 5 ? "firm" : "practice";
}

async function main(): Promise<void> {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  const uri = process.env.MONGO_URI ?? "mongodb://localhost:27017/legalerrand";

  await mongoose.connect(uri);
  console.log(`Connected to MongoDB${dryRun ? " (dry run — nothing will be written)" : ""}`);

  const firms = await Firm.find();
  console.log(`${firms.length} firms found`);

  let subscriptionsCreated = 0;
  let placesFilled = 0;
  const needsPrice: string[] = [];

  for (const firm of firms) {
    const seatsInUse = await FirmMember.countDocuments({ firmId: firm._id, isActive: true });

    if (!firm.country || !firm.state) {
      const place = placeFromJurisdiction(firm.jurisdiction);
      const country = firm.country || place.country;
      const state = firm.state || place.state;
      if (country !== firm.country || state !== firm.state) {
        placesFilled++;
        if (!dryRun) {
          firm.country = country;
          if (state) firm.state = state;
          await firm.save();
        }
        console.log(`  ${firm.name}: ${country}${state ? ` · ${state}` : ""}`);
      }
    }

    const existing = await Subscription.findOne({ firmId: firm._id });
    if (existing) continue;

    const plan = planFromLegacy(firm.subscriptionPlan, seatsInUse);
    // Existing firms are treated as active and paying the list price. Anything
    // subtler than that is a guess, and a wrong guess here is money.
    const seats = Math.max(seatsFor(plan), seatsInUse, firm.feeEarnerCapacity);
    subscriptionsCreated++;

    const mrr = listPriceFor(plan);
    console.log(
      `  ${firm.name}: ${firm.subscriptionPlan} → ${plan}, ${seats} seats, ₦${mrr.toLocaleString("en-GB")}/mo`
    );
    // Enterprise has no list price, so this firm now counts as ₦0 towards MRR
    // until someone records what was actually agreed. Better said out loud than
    // discovered in a revenue figure.
    if (plan === "enterprise") {
      console.log(`    ↳ needs a negotiated price — counts as ₦0 until one is set`);
      needsPrice.push(firm.name);
    }

    if (!dryRun) {
      await Subscription.create({
        firmId: firm._id,
        plan,
        status: "active",
        seats,
        mrr,
        startedAt: firm.createdAt ?? new Date(),
      });
      // The field now holds the catalogue's own name.
      if (firm.subscriptionPlan !== plan) {
        firm.subscriptionPlan = plan;
        await firm.save();
      }
    }
  }

  console.log(
    `\n${subscriptionsCreated} subscriptions ${dryRun ? "would be" : ""} created, ` +
      `${placesFilled} firms ${dryRun ? "would have" : "had"} their location filled in`
  );
  if (needsPrice.length) {
    console.log(
      `\n${needsPrice.length} on Enterprise with no agreed price yet: ${needsPrice.join(", ")}`
    );
  }
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
