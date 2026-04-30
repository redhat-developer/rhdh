import { defineConfig } from "@playwright/test";
import path from "node:path";

const PORT = 7007;
const BASE_URL = `http://localhost:${PORT}`;
const REPO_ROOT = path.resolve(__dirname, "..");

export default defineConfig({
  // Reuse existing e2e specs directly -- no copying
  testDir: path.join(REPO_ROOT, "e2e-tests", "playwright"),

  use: {
    baseURL: BASE_URL,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },

  // Same test files as showcase-sanity-plugins
  testMatch: [
    "**/e2e/instance-health-check.spec.ts",
    "**/e2e/home-page-customization.spec.ts",
    "**/e2e/plugins/frontend/sidebar.spec.ts",
    "**/e2e/catalog-timestamp.spec.ts",
  ],

  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 3,

  // Start the real Backstage backend before tests
  webServer: {
    command: `yarn start --config ../../sanity-plugin-check/app-config.sanity-test.yaml`,
    cwd: path.join(REPO_ROOT, "packages", "backend"),
    port: PORT,
    reuseExistingServer: true,
    timeout: 180_000,
    env: {
      NODE_ENV: "development",
      NODE_OPTIONS: "--no-node-snapshot",
    },
  },
});
