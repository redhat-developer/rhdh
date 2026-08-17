import { defineConfig } from "@playwright/test";

import {
  backendUrl,
  backendWebServer,
  harnessReporters,
  isCI,
} from "./playwright/support/local-harness-servers";

/**
 * Cluster-free plugin sanity check (RHIDP-13508) — boots `packages/backend`
 * from source against a dynamic-plugins-root populated from
 * CATALOG_INDEX_IMAGE. Request-only: no browser, no frontend dev server.
 * See "Plugin Sanity Check" in e2e-tests/README.md.
 */
export default defineConfig({
  testDir: "./playwright",
  globalSetup: "./playwright/support/plugin-sanity-global-setup.ts",
  testMatch: ["cluster-free/plugin-dynamic-loading.spec.ts"],
  timeout: 120 * 1000,
  forbidOnly: isCI,
  // The spec is a deterministic API comparison against a single backend boot;
  // retrying re-queries the same state, so retries only mask real failures.
  retries: 0,
  workers: 1,
  reporter: harnessReporters("plugin-sanity"),
  use: {
    baseURL: backendUrl,
  },
  webServer: [
    {
      // Dummy values for plugins that abort the backend when their config is
      // missing; passed last so it wins over generated plugin defaults.
      ...backendWebServer(["e2e-tests/local-harness/app-config.plugin-sanity.yaml"]),
      // Never adopt a backend already on :7007. The spec compares
      // dynamic-plugins-root against what the RUNNING backend loaded, so a
      // leftover legacy-local backend (curated plugin set, booted without the
      // config above) would make it pass while validating nothing current.
      reuseExistingServer: false,
    },
  ],
});
