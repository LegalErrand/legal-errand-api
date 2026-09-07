/**
 * Copy platform content from prod MongoDB (`legalerrand`) into staging/dev (`test`).
 *
 * Same Atlas cluster + shared S3 bucket — only Mongo library documents need syncing.
 * Preserves tester accounts and user uploads on the destination DB.
 *
 * Usage:
 *   npx ts-node --transpile-only src/scripts/syncProdContentToDev.ts
 *
 * Optional env overrides:
 *   PROD_MONGO_URI  — source (defaults to .env.production MONGO_URI)
 *   DEV_MONGO_URI   — destination (defaults to .env.staging MONGO_URI)
 */
import fs from "fs";
import path from "path";
import { MongoClient, Document } from "mongodb";

function loadEnvFile(fileName: string): Record<string, string> {
  const filePath = path.resolve(__dirname, "../..", fileName);
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function main(): Promise<void> {
  const prodEnv = loadEnvFile(".env.production");
  const stagingEnv = loadEnvFile(".env.staging");

  const prodUri = process.env.PROD_MONGO_URI || prodEnv.MONGO_URI;
  const devUri = process.env.DEV_MONGO_URI || stagingEnv.MONGO_URI;

  if (!prodUri || !devUri) {
    throw new Error("Missing PROD_MONGO_URI / DEV_MONGO_URI (or .env.production / .env.staging)");
  }

  if (prodUri === devUri) {
    throw new Error("Refusing to sync: source and destination URIs are identical");
  }

  const prodClient = new MongoClient(prodUri);
  const devClient = new MongoClient(devUri);

  try {
    await Promise.all([prodClient.connect(), devClient.connect()]);
    const prodDb = prodClient.db();
    const devDb = devClient.db();

    console.log(`Source DB: ${prodDb.databaseName}`);
    console.log(`Destination DB: ${devDb.databaseName}`);

    const prodDocs = prodDb.collection("documents");
    const devDocs = devDb.collection("documents");

    const sourceCount = await prodDocs.countDocuments({ type: "case_law" });
    const destCaseLawBefore = await devDocs.countDocuments({ type: "case_law" });
    const destUploads = await devDocs.countDocuments({ type: "user_upload" });

    console.log(`Prod case_law: ${sourceCount}`);
    console.log(`Dev case_law before: ${destCaseLawBefore}`);
    console.log(`Dev user_upload (kept): ${destUploads}`);

    const deleteResult = await devDocs.deleteMany({
      $or: [{ type: "case_law" }, { isLibraryContent: true, type: { $ne: "user_upload" } }],
    });
    console.log(`Removed ${deleteResult.deletedCount} library docs from destination`);

    const cursor = prodDocs.find({ type: "case_law" });
    const batch: Document[] = [];
    let inserted = 0;

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (!doc) continue;
      batch.push(doc);
      if (batch.length >= 200) {
        await devDocs.insertMany(batch, { ordered: false });
        inserted += batch.length;
        process.stdout.write(`\rInserted ${inserted}/${sourceCount}`);
        batch.length = 0;
      }
    }

    if (batch.length) {
      await devDocs.insertMany(batch, { ordered: false });
      inserted += batch.length;
    }
    console.log(`\nInserted ${inserted} case_law documents`);

    // Optional: sync waitlist so staging mirrors prod lead data (idempotent replace)
    const prodWaitlist = await prodDb.collection("waitlists").find({}).toArray();
    if (prodWaitlist.length) {
      await devDb.collection("waitlists").deleteMany({});
      await devDb.collection("waitlists").insertMany(prodWaitlist, { ordered: false });
      console.log(`Synced waitlists: ${prodWaitlist.length}`);
    }

    const destCaseLawAfter = await devDocs.countDocuments({ type: "case_law" });
    const destUploadsAfter = await devDocs.countDocuments({ type: "user_upload" });
    console.log("Done.");
    console.log(`Dev case_law after: ${destCaseLawAfter}`);
    console.log(`Dev user_upload after: ${destUploadsAfter}`);
    console.log("Note: questions are empty on both environments — nothing to copy there.");
  } finally {
    await Promise.all([prodClient.close(), devClient.close()]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
