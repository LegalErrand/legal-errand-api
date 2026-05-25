/**
 * Install Husky git hooks locally only.
 * Skipped on Render/CI and when devDependencies are not installed (NODE_ENV=production).
 */
const { execSync } = require("child_process");

const skip =
  process.env.CI === "true" ||
  process.env.RENDER === "true" ||
  process.env.HUSKY === "0" ||
  process.env.NODE_ENV === "production";

if (skip) {
  process.exit(0);
}

try {
  execSync("husky", { stdio: "inherit" });
} catch {
  // husky is a devDependency — not present in production-only installs
  process.exit(0);
}
