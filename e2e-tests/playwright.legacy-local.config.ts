import { defineConfig, devices } from "@playwright/test";

import {
  backendWebServer,
  harnessConfigArgs,
  isCI,
  pathWithRepoBin,
} from "./playwright/support/local-harness-servers";

// Packaged-app sidebar markup differs from the RHDH container global-header sidebar
// even though /healthcheck returns JSON via the dev-server proxy.
// Intentional divergence: force legacy sidebar adapter for cluster-free harness.
process.env.E2E_FORCE_LEGACY_SIDEBAR = "true";

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
 * `app-config.local-e2e.yaml` plus the dynamic-plugins UI config (shared setup:
 * playwright/support/local-harness-servers.ts). An already-running pair of
 * servers is reused locally; in CI they are started fresh. Re-run populate.sh
 * after changing the harness plugin set.
 */

const frontendUrl = "http://localhost:3000";

export default defineConfig({
  testDir: "./playwright",
  // Fails fast if dynamic-plugins-root has not been populated.
  globalSetup: "./playwright/support/local-harness-global-setup.ts",
  // A test runs cluster-free when its spec file is listed in `testMatch` (an
  // allowlist, so unvalidated specs are never loaded) AND it carries the
  // @cluster-free-capable tag. To widen coverage: tag the test where it lives and add its
  // spec file here. Validated so far: the full guest-signin spec (home page via the
  // dynamic-home-page OCI plugin; Settings/Sign-out via the global-header OCI plugin
  // with its canonical pluginConfig), the learning-paths spec (static fallback
  // data bundled with packages/app), and the instance health check (/healthcheck is
  // proxied to the backend by the app dev server — see packages/app package.json —
  // mirroring the single-origin production container).
  testMatch: [
    "e2e/guest-signin-happy-path.spec.ts",
    "e2e/learning-path-page.spec.ts",
    "e2e/instance-health-check.spec.ts",
    "e2e/smoke-test.spec.ts",
    "e2e/home-page-customization.spec.ts",
    "e2e/plugins/frontend/sidebar.spec.ts",
    "e2e/settings.spec.ts",
    "e2e/plugins/user-settings-info-card.spec.ts",
    "e2e/plugins/application-provider.spec.ts",
    "e2e/plugins/application-listener.spec.ts",
  ],
  // The optional `-capable` keeps branches still carrying the old @cluster-free
  // spelling working while they land. Without it they are silently dropped from
  // this run — no error, the tests just stop executing here. Drop the
  // alternation once no in-flight branch uses the old tag.
  grep: /@cluster-free(-capable)?/u,
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
  webServer: [
    backendWebServer(),
    {
      command: `janus-cli package start ${harnessConfigArgs()}`,
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
