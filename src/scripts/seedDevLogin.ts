/**
 * Creates a firm member you can actually log in as, for local development.
 *
 * The firm app requires a password and then an emailed one-time code. Without
 * an inbox there is no way to finish that flow by hand, which leaves every
 * authenticated screen unverifiable. This seeds the password half; the code
 * half is printed to the server log by the dev-only reveal in the auth
 * controller, which is gated on NODE_ENV === "development".
 *
 * It refuses to run against production. It does not weaken the login flow:
 * the member it creates is an ordinary one with an ordinary hashed password.
 *
 *   npm run seed:dev-login
 */
import "dotenv/config";
import mongoose from "mongoose";
import { env } from "../config/env";
import { Firm, FirmMember } from "../models/firm";

const EMAIL = process.env.DEV_LOGIN_EMAIL ?? "dev@oladipupoco.ng";
const PASSWORD = process.env.DEV_LOGIN_PASSWORD ?? "DevPassword123!";
const ROLE = process.env.DEV_LOGIN_ROLE ?? "managing_partner";

async function run(): Promise<void> {
  if (env.NODE_ENV === "production") {
    console.error("Refusing to run: this creates a known password and NODE_ENV is production.");
    process.exit(1);
  }

  await mongoose.connect(env.MONGO_URI);

  // Attach to whichever firm the other seeds made, or stand one up.
  let firm = await Firm.findOne().sort({ createdAt: 1 });
  if (!firm) {
    firm = await Firm.create({ name: "Oladipupo & Co", slug: "oladipupo-co" });
    console.log(`Created firm: ${String(firm.get("name"))}`);
  }

  // A slug is what the public intake form resolves a firm by, so a firm
  // without one cannot be reached at /intake/[firmSlug].
  if (!firm.get("slug")) {
    firm.set("slug", "oladipupo-co");
    await firm.save();
    console.log(`Gave ${firm.name} the slug "oladipupo-co"`);
  }

  // The model hashes on save, so the plain password goes in — hashing it here
  // too would store a hash of a hash and no login would ever match.
  const existing = await FirmMember.findOne({ email: EMAIL });
  if (existing) {
    existing.set({
      password: PASSWORD,
      isActive: true,
      firmId: firm._id,
      role: ROLE,
      passwordChangedAt: undefined,
    });
    await existing.save();
    console.log(`Reset the password for the existing member ${EMAIL}`);
  } else {
    const member = new FirmMember();
    member.set({
      firmId: firm._id,
      name: "Dev Partner",
      initials: "DP",
      email: EMAIL,
      password: PASSWORD,
      role: ROLE,
      isActive: true,
    });
    await member.save();
    console.log(`Created member ${EMAIL}`);
  }

  console.log("");
  console.log("  Firm:     ", String(firm.get("name")), `(slug: ${String(firm.get("slug"))})`);
  console.log("  Email:    ", EMAIL);
  console.log("  Password: ", PASSWORD);
  console.log("  Role:     ", ROLE);
  console.log("");
  console.log("  Sign in, then read the six-digit code from the API server log.");
  console.log('  It is printed there only while NODE_ENV is "development".');
  console.log("");

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
