/**
 * S3 Pre-signed URL test script
 * Run: npx ts-node --transpile-only src/scripts/test-s3.ts
 */

import dotenv from "dotenv";
dotenv.config();

import { s3Service } from "../services/storage/s3.service";
import { logger } from "../utils/logger";

const TEST_S3_KEY = "documents/test-placeholder.txt";

async function runTests() {
  console.log("\n========================================");
  console.log("  S3 Pre-signed URL Tests");
  console.log("========================================\n");

  // ── Test 1: Generate pre-signed download URL ─────────────────────────────
  console.log("TEST 1: Generate pre-signed GET (download) URL");
  console.log("------------------------------------------------");
  try {
    const downloadUrl = await s3Service.getSignedDownloadUrl(TEST_S3_KEY, 3600);
    console.log("✅ Success");
    console.log("   URL (1h expiry):", downloadUrl.slice(0, 80) + "...");
  } catch (err) {
    console.log("❌ Failed:", (err as Error).message);
  }

  // ── Test 2: Generate pre-signed upload URL ───────────────────────────────
  console.log("\nTEST 2: Generate pre-signed PUT (upload) URL");
  console.log("----------------------------------------------");
  try {
    const { uploadUrl, s3Key, s3Url } = await s3Service.getSignedUploadUrl(
      "DOCUMENTS",
      "test-file.pdf",
      "application/pdf",
      300
    );
    console.log("✅ Success");
    console.log("   s3Key :", s3Key);
    console.log("   s3Url :", s3Url);
    console.log("   uploadUrl:", uploadUrl.slice(0, 80) + "...");
  } catch (err) {
    console.log("❌ Failed:", (err as Error).message);
  }

  // ── Test 3: Check if a file exists ───────────────────────────────────────
  console.log("\nTEST 3: Check file existence (HeadObject)");
  console.log("-------------------------------------------");
  try {
    const exists = await s3Service.fileExists(TEST_S3_KEY);
    console.log(`✅ Success — file ${exists ? "EXISTS" : "does NOT exist"} at key: ${TEST_S3_KEY}`);
  } catch (err) {
    console.log("❌ Failed:", (err as Error).message);
  }

  console.log("\n========================================");
  console.log("  Done");
  console.log("========================================\n");
}

runTests().catch((err) => {
  logger.error("Test script crashed:", err);
  process.exit(1);
});
