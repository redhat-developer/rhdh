import { defineConfig } from "@playwright/test";

import { backendUrl, backendWebServer, isCI } from "./playwright/support/local-harness-servers";

/**
 * Cluster-free plugin sanity check (RHIDP-13508) — validates that every plugin
 * enabled by the catalog index loads in the real RHDH backend.
 *
 * Playwright boots `packages/backend` from source (the same wiring the product
 * ships, including dynamicPluginsFeatureLoader) against a dynamic-plugins-root
 * populated from CATALOG_INDEX_IMAGE, then the spec compares the installed
 * plugin set with what the backend actually loaded
 * (/api/dynamic-plugins-info/loaded-plugins). No browser and no frontend dev
 * server — the spec is request-only.
 *
 *   # one-time: populate dynamic-plugins-root from the catalog index
 *   CATALOG_INDEX_IMAGE=quay.io/rhdh/plugin-catalog-index:next \
 *     ./e2e-tests/local-harness/populate-catalog-index.sh
 *
 *   yarn --cwd e2e-tests plugin-sanity
 *
 * Runs in CI as part of the nightly OCP job, right after the cluster-based
 * sanity-plugins deployment (testing::run_plugin_sanity_check in
 * .ci/pipelines/lib/testing.sh). Override the index via Gangway
 * (--catalog-index-image) for RC verification.
 */
export default defineConfig({
  testDir: "./playwright",
  // Fails fast if dynamic-plugins-root has not been populated FROM THE INDEX.
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
