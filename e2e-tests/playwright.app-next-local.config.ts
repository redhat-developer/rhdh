import { defineConfig, devices } from "@playwright/test";
import { resolve } from "path";

/**
 * Cluster-free local E2E harness for the new frontend system (`packages/app-next`).
 *
 * Layer 4a spike (RHIDP-13501): run real Playwright E2E against RHDH without an
 * OpenShift/Kubernetes cluster or container images. Playwright boots the backend
 * and the app-next dev server itself, then drives the browser against them.
 * See docs/e2e-tests/local-e2e-harness.md (note: dynamic frontend plugins do not
 * load on app-next yet — use the legacy harness for those).
 *
 *   yarn e2e:app-next-local
 *
 * Both servers are started via `webServer` below with the guest-auth overlay
 * `app-config.local-e2e.yaml`. Locally, an already-running pair of servers
 * is reused (`reuseExistingServer`); in CI they are always started fresh.
 *
 * `backstage-cli` lives in the repo-root node_modules/.bin, which yarn does not
 * surface for these workspaces, so both CLIs are invoked directly with the root
 * .bin prepended to PATH and run from their package directory.
 */

const frontendUrl = "http://localhost:3000";
const backendReadiness = "http://localhost:7007/.backstage/health/v1/readiness";
const repoRootBin = resolve(process.cwd(), "..", "node_modules", ".bin");

export default defineConfig({
  testDir: "./playwright/app-next-local",
  timeout: 90 * 1000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    [
      "html",
      { open: "never", outputFolder: "playwright-report-app-next-local" },
    ],
    [
      "junit",
      {
        outputFile:
          process.env.JUNIT_RESULTS || "junit-results-app-next-local.xml",
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
  // Two local servers, no cluster. `--config` paths are resolved relative to each
  // package dir (where backstage-cli runs), hence the `../../` prefix.
  webServer: [
    {
      command:
        "backstage-cli package start --require ./src/instrumentation.js " +
        "--config ../../app-config.yaml --config ../../app-config.local-e2e.yaml",
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
      command:
        "backstage-cli package start --config ../../app-config.yaml " +
        "--config ../../app-config.local-e2e.yaml",
      cwd: "../packages/app-next",
      env: { ...process.env, PATH: `${repoRootBin}:${process.env.PATH}` },
      url: frontendUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 180 * 1000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
