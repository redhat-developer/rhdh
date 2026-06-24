import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["playwright/utils/**/*.test.ts"],
  },
});
