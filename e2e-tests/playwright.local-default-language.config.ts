import { defineConfig, devices } from "@playwright/test";

import {
  backendWebServer,
  harnessConfigArgs,
  harnessProcessEnv,
  harnessReporters,
  isCI,
} from "./playwright/support/local-harness-servers";

/**
 * Cluster-free harness with api:app/app-language.defaultLanguage=fr and no
 * localStorage seeding. See docs/e2e-tests/default-language.md.
 *
 *   yarn --cwd e2e-tests e2e:local:default-language
 *
 * Do not reuse a server started by e2e:local (defaultLanguage en).
 */

process.env.LOCALE = "fr";
process.env.APP_DEFAULT_LANGUAGE = "fr";

const frontendUrl = "http://localhost:3000";

const processEnv: Record<string, string> = {
  ...harnessProcessEnv,
  LOCALE: "fr",
  APP_DEFAULT_LANGUAGE: "fr",
};

export default defineConfig({
  testDir: "./playwright",
  globalSetup: "./playwright/support/local-harness-global-setup.ts",
  testMatch: ["e2e/default-language.spec.ts"],
  grep: /@cluster-free(-capable)?/u,
  timeout: 90 * 1000,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  reporter: harnessReporters("local-default-language"),
  use: {
    baseURL: frontendUrl,
    locale: "fr",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1920, height: 1080 },
    actionTimeout: 15 * 1000,
    navigationTimeout: 60 * 1000,
  },
  expect: {
    timeout: 15 * 1000,
  },
  webServer: [
    {
      ...backendWebServer(),
      env: processEnv,
      // Always start fresh so APP_DEFAULT_LANGUAGE=fr is applied.
      reuseExistingServer: false,
    },
    {
      command: `backstage-cli package start ${harnessConfigArgs()}`,
      cwd: "../packages/app",
      env: processEnv,
      url: frontendUrl,
      reuseExistingServer: false,
      timeout: 240 * 1000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
