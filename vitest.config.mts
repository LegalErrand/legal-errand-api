import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests share one database, so they must not interleave.
    fileParallelism: false,
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/__tests__/helpers/setup.ts"],
    // A cold Mongo connection and bcrypt rounds are slower than a unit test.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
