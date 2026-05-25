/**
 * One-time script to create the initial super admin account.
 * Usage: npx ts-node --transpile-only src/scripts/createSuperAdmin.ts
 */
import mongoose from "mongoose";
import { config } from "dotenv";
import path from "path";

config({ path: path.resolve(__dirname, "../../.env") });

// Import after env is loaded
import { Admin } from "../models/Admin";

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017/legalerrand";

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");

  const email = (process.env.SUPER_ADMIN_EMAIL ?? "admin@legalerrand.com").toLowerCase().trim();
  const password = process.env.SUPER_ADMIN_PASSWORD ?? "Admin@1234!";

  const existing = await Admin.findOne({ email }).select("+password");
  if (existing) {
    existing.password = password;
    existing.role = "super_admin";
    existing.isBlocked = false;
    await existing.save();
    const ok = await existing.comparePassword(password);
    console.log(`Super admin already exists — password reset: ${email}`);
    console.log(`   Password verified: ${ok ? "yes" : "NO"}`);
    process.exit(0);
  }

  const admin = new Admin({
    firstName: "Super",
    lastName: "Admin",
    email,
    password,
    role: "super_admin",
  });

  await admin.save();
  console.log(`✅ Super admin created`);
  console.log(`   Email:    ${email}`);
  console.log(`   Password: ${password}`);
  console.log(`\nChange the password immediately after first login.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
