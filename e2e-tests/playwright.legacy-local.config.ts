import { defineConfig, devices } from "@playwright/test";
import { resolve } from "path";

/**
 * Cluster-free local E2E harness for the legacy frontend (`packages/app`) — Tier B.
 *
 * RHIDP-13501 (E2E Test Optimization). Runs the EXISTING Playwright specs against a
 * production-faithful RHDH instance with dynamic plugins loaded, without an
 * OpenShift/Kubernetes cluster or container images. Playwright boots the backend and
 * the legacy app dev server itself and drives the browser against them.
 *
 *   # one-time: populate dynamic-plugins-root (production-faithful — full plugin set
 *   # and generated config, same source CI uses):
 *   CATALOG_INDEX_IMAGE=<quay.io/rhdh/plugin-catalog-index:TAG> \
 *     npx @red-hat-developer-hub/cli-module-install-dynamic-plugins install dynamic-plugins-root
 *   # (offline alternative, frontend plugins only, needs reconciled deps:
 *   #  yarn --cwd dynamic-plugins export-dynamic && \
 *   #  yarn --cwd dynamic-plugins copy-dynamic-plugins ../dynamic-plugins-root)
 *
 *   yarn --cwd e2e-tests e2e:legacy-local
 *
 * Both servers are started via `webServer` with the guest-auth overlay
 * `app-config.local-e2e.yaml` plus the dynamic-plugins UI config. An already-running
 * pair of servers is reused locally; in CI they are started fresh.
 *
 * `janus-cli` (legacy app dev server) lives in the repo-root node_modules/.bin, which
 * yarn does not surface for the `app` workspace, so the frontend webServer prepends it
 * to PATH explicitly.
 */

const frontendUrl = "http://localhost:3000";
const backendReadiness = "http://localhost:7007/.backstage/health/v1/readiness";
const repoRootBin = resolve(process.cwd(), "..", "node_modules", ".bin");

const sharedConfigArgs =
  "--config ../../app-config.yaml " +
  "--config ../../app-config.dynamic-plugins.yaml " +
  "--config ../../app-config.local-e2e.yaml";

export default defineConfig({
  testDir: "./playwright",
  // Existing UI specs that do not require live external services (cluster, GitHub
  // org, Quay, Tekton, Keycloak). Expand as more specs are validated off-cluster.
  testMatch: [
    "e2e/guest-signin-happy-path.spec.ts",
    "e2e/settings.spec.ts",
    "e2e/learning-path-page.spec.ts",
    "e2e/home-page-customization.spec.ts",
  ],
  timeout: 90 * 1000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report-legacy-local" }],
    [
      "junit",
      { outputFile: process.env.JUNIT_RESULTS || "junit-results-legacy-local.xml" },
    ],
  ],
  use: {
    baseURL: frontendUrl,
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
  // backstage-cli / janus-cli live in the repo-root node_modules/.bin, which yarn does
  // not surface for these workspaces, so both CLIs are invoked directly with the root
  // .bin prepended to PATH and run from their package directory.
  webServer: [
    {
      command: `backstage-cli package start --require ./src/instrumentation.js ${sharedConfigArgs}`,
      cwd: "../packages/backend",
      env: {
        ...process.env,
        PATH: `${repoRootBin}:${process.env.PATH}`,
        NODE_OPTIONS: "--no-node-snapshot",
      },
      url: backendReadiness,
      reuseExistingServer: !process.env.CI,
      timeout: 180 * 1000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `janus-cli package start ${sharedConfigArgs}`,
      cwd: "../packages/app",
      env: { ...process.env, PATH: `${repoRootBin}:${process.env.PATH}` },
      url: frontendUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 240 * 1000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
