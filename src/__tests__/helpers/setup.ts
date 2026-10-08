import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { beforeAll, afterAll, beforeEach, vi } from "vitest";

/**
 * Integration tests run against the real Express app and a real Mongo, because
 * what is worth testing here is the middleware, the tenancy scoping and the
 * Mongoose behaviour — all of which a mocked database would quietly skip.
 *
 * ── The one hard rule ───────────────────────────────────────────────────────
 * Tests drop collections between cases, so this refuses to run against any
 * database whose name does not end in `_test`. That guard is the reason it is
 * safe to point MONGODB_URI at the same cluster the dev server uses.
 */

function loadEnv(): void {
  const envPath = path.resolve(__dirname, "../../../.env");
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

/** Rewrites a Mongo URI to point at a sibling database suffixed `_test`. */
export function testDatabaseUri(uri: string): string {
  const [base, query] = uri.split("?");
  const withoutTrailing = base.replace(/\/$/, "");
  const lastSlash = withoutTrailing.lastIndexOf("/");
  const host = withoutTrailing.slice(0, lastSlash);
  const dbName = withoutTrailing.slice(lastSlash + 1) || "legalerrand";
  const testName = dbName.endsWith("_test") ? dbName : `${dbName}_test`;
  return `${host}/${testName}${query ? `?${query}` : ""}`;
}

// Nothing in a test should attempt real mail. Every sender resolves true so the
// "did it send" branches can still be exercised; sendSignatureRequest and the
// rest are added by name as the modules under test need them.
vi.mock("../../services/email/email.service", () => {
  const sent = async () => true;
  return {
    emailService: new Proxy({}, { get: () => sent }),
    sendWaitlistConfirmationEmail: sent,
  };
});

beforeAll(async () => {
  loadEnv();
  process.env.NODE_ENV = "test";

  const raw = process.env.MONGODB_URI_TEST || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!raw) throw new Error("Set MONGODB_URI (or MONGODB_URI_TEST) before running tests.");

  const uri = testDatabaseUri(raw);
  await mongoose.connect(uri);

  const name = mongoose.connection.name;
  if (!name.endsWith("_test")) {
    await mongoose.disconnect();
    throw new Error(
      `Refusing to run: the test database is "${name}", which does not end in _test. ` +
        `Tests drop collections, so this guard is deliberate.`
    );
  }
});

beforeEach(async () => {
  // A clean slate per test, so order never matters and a failure cannot
  // cascade into the next case.
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
});
