import { resolve } from "path";

import { defineConfig, devices } from "@playwright/test";

/**
 * Cluster-free local E2E harness for the legacy frontend (`packages/app`) — Tier B.
 *
 * RHIDP-13501 (E2E Test Optimization). Runs the EXISTING Playwright specs against a
 * production-faithful RHDH instance with dynamic plugins loaded, without an
 * OpenShift/Kubernetes cluster or container images. Playwright boots the backend and
 * the legacy app dev server itself and drives the browser against them.
 *
 *   # one-time: populate dynamic-plugins-root (same script CI uses — OCI, no build;
 *   # alternatives in docs/e2e-tests/local-e2e-harness.md):
 *   ./e2e-tests/local-harness/populate.sh
 *
 *   yarn --cwd e2e-tests e2e:legacy-local
 *
 * Both servers are started via `webServer` with the guest-auth overlay
 * `app-config.local-e2e.yaml` plus the dynamic-plugins UI config. An already-running
 * pair of servers is reused locally; in CI they are started fresh.
 */

const frontendUrl = "http://localhost:3000";
const backendReadiness = "http://localhost:7007/.backstage/health/v1/readiness";
const repoRootBin = resolve(process.cwd(), "..", "node_modules", ".bin");
const pathWithRepoBin = `${repoRootBin}:${process.env.PATH ?? ""}`;
const isCI = process.env.CI !== undefined && process.env.CI !== "";

const sharedConfigArgs = [
  "--config ../../app-config.yaml",
  "--config ../../app-config.dynamic-plugins.yaml",
  "--config ../../app-config.local-e2e.yaml",
].join(" ");

export default defineConfig({
  testDir: "./playwright",
  // Fails fast if dynamic-plugins-root has not been populated.
  globalSetup: "./playwright/support/local-harness-global-setup.ts",
  // A test runs cluster-free when its spec file is listed in `testMatch` (an
  // allowlist, so unvalidated specs are never loaded) AND it carries the
  // @cluster-free tag. To widen coverage: tag the test where it lives and add its
  // spec file here. Today that is the guest-signin home-page test, verified green
  // off-cluster (the dynamic home-page plugin renders from OCI); its sibling
  // Settings/Sign-out tests stay untagged because they navigate via the top-right
  // profile dropdown, which needs the global-header plugin to *mount* in the
  // layout — it loads off-cluster but rendering it needs more config (follow-up).
  testMatch: ["e2e/guest-signin-happy-path.spec.ts"],
  grep: /@cluster-free/u,
  timeout: 90 * 1000,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // serial: a single shared backend + dev server
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report-legacy-local" }],
    [
      "junit",
      {
        outputFile: process.env.JUNIT_RESULTS ?? "junit-results-legacy-local.xml",
      },
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
  // .bin prepended to PATH and run from their package directory. The backend command
  // mirrors packages/backend's `start` script (--require instrumentation) — keep in sync.
  webServer: [
    {
      command: `backstage-cli package start --require ./src/instrumentation.js ${sharedConfigArgs}`,
      cwd: "../packages/backend",
      env: {
        ...process.env,
        PATH: pathWithRepoBin,
        NODE_OPTIONS: "--no-node-snapshot",
      },
      url: backendReadiness,
      reuseExistingServer: !isCI,
      timeout: 180 * 1000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `janus-cli package start ${sharedConfigArgs}`,
      cwd: "../packages/app",
      env: { ...process.env, PATH: pathWithRepoBin },
      url: frontendUrl,
      reuseExistingServer: !isCI,
      timeout: 240 * 1000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
