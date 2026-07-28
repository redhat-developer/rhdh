import { defineConfig } from "@playwright/test";

import { backendUrl, backendWebServer, isCI } from "./playwright/support/local-harness-servers";

/**
 * Cluster-free plugin sanity check (RHIDP-13508) — boots `packages/backend`
 * from source against a dynamic-plugins-root populated from
 * CATALOG_INDEX_IMAGE. Request-only: no browser, no frontend dev server.
 * See "Plugin Sanity Check" in e2e-tests/README.md.
 */
export default defineConfig({
  testDir: "./playwright",
  globalSetup: "./playwright/support/plugin-sanity-global-setup.ts",
  testMatch: ["e2e/plugin-dynamic-loading.spec.ts"],
  timeout: 120 * 1000,
  forbidOnly: isCI,
  // The spec is a deterministic API comparison against a single backend boot;
  // retrying re-queries the same state, so retries only mask real failures.
  retries: 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report-plugin-sanity" }],
    [
      "junit",
      {
        outputFile: process.env.JUNIT_RESULTS ?? "junit-results-plugin-sanity.xml",
      },
    ],
  ],
  use: {
    baseURL: backendUrl,
  },
  // Dummy values for plugins that abort the backend when their config is
  // missing; passed last so it wins over generated plugin defaults.
  webServer: [backendWebServer(["../../app-config.plugin-sanity.yaml"])],
});
