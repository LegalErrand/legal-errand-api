/**
 * Moves Firm.subscriptionPlan onto the catalogue's own names.
 *
 * The field used to hold starter | professional | enterprise. It now holds a
 * FirmPlan — starter | practice | firm | enterprise — so any row still saying
 * "professional" fails validation on its next save.
 *
 * "professional" was lossy: Practice and Firm both folded into it, and nothing
 * recorded which. This maps it to **practice**, the cheaper of the two, because
 * over-charging a firm on a guess is worse than under-charging one. Where a
 * Subscription exists it is believed instead, since that carries the real plan.
 *
 *   npm run migrate:plan-names -- --dry-run
 *   npm run migrate:plan-names
 */
import "dotenv/config";
import mongoose from "mongoose";
import { env } from "../config/env";
import { Subscription } from "../models/firm";
import { isFirmPlan, planFromLegacyValue, type FirmPlan } from "../config/plans";

const DRY_RUN = process.argv.includes("--dry-run");

async function run(): Promise<void> {
  await mongoose.connect(env.MONGO_URI);

  // Read raw, because the typed model would reject the old values on the way in.
  const rows = await mongoose.connection
    .collection("firms")
    .find({}, { projection: { name: 1, subscriptionPlan: 1 } })
    .toArray();

  let changed = 0;
  let alreadyFine = 0;

  for (const row of rows) {
    const current = String(row.subscriptionPlan ?? "");
    if (isFirmPlan(current)) {
      alreadyFine += 1;
      continue;
    }

    // A subscription knows the real plan; prefer it over the lossy guess.
    const subscription = await Subscription.findOne({ firmId: row._id }).select("plan").lean();
    const fromSubscription =
      subscription && isFirmPlan(subscription.plan) ? (subscription.plan as FirmPlan) : null;
    const next = fromSubscription ?? planFromLegacyValue(current);
    const basis = fromSubscription ? "from its subscription" : "mapped from the old value";

    console.log(`  ${String(row.name)}: ${current || "(unset)"} → ${next} (${basis})`);
    changed += 1;

    if (!DRY_RUN) {
      await mongoose.connection
        .collection("firms")
        .updateOne({ _id: row._id }, { $set: { subscriptionPlan: next } });
    }
  }

  console.log("");
  console.log(
    `  ${rows.length} firms · ${alreadyFine} already on a catalogue name · ${changed} ${DRY_RUN ? "would change" : "changed"}`
  );
  if (DRY_RUN) console.log("  Dry run — nothing was written.");
  console.log("");

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
