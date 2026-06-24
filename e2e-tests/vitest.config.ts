import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // E2E specs: playwright/e2e/**/*.spec.ts (Playwright). Unit tests: unit/**/*.test.ts.
    include: ["unit/**/*.test.ts"],
  },
});
