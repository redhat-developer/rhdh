import { defineConfig, devices } from "@playwright/test";

const k8sSpecificConfig = {
  use: {
    actionTimeout: 15 * 1000,
  },
  expect: {
    timeout: 15 * 1000, // Global expect timeout
  },
};

export default defineConfig({
  timeout: 90 * 1000,
  testDir: "./playwright",
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: 3,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ["html"],
    ["list"],
    ["junit", { outputFile: "junit-results.xml" }],
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL: process.env.BASE_URL,
    ignoreHTTPSErrors: true,
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1920, height: 1080 },
    video: {
      mode: "on",
      size: { width: 1920, height: 1080 },
    },
    actionTimeout: 10 * 1000,
    navigationTimeout: 50 * 1000,
  },
  expect: {
    timeout: 10 * 1000, // Global expect timeout
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "smoke-test",
      testMatch: "**/playwright/e2e/smoke-test.spec.ts",
      retries: 10,
    },
    {
      name: "showcase",
      testIgnore: [
        "**/playwright/e2e/plugins/rbac/**/*.spec.ts",
        "**/playwright/e2e/plugins/analytics/analytics-disabled-rbac.spec.ts",
        "**/playwright/e2e/verify-tls-config-with-external-postgres-db.spec.ts",
        "**/playwright/e2e/authProviders/**/*.spec.ts",
        "**/playwright/e2e/plugins/bulk-import.spec.ts",
        "**/playwright/e2e/verify-tls-config-health-check.spec.ts",
        "**/playwright/e2e/configuration-test/config-map.spec.ts",
        "**/playwright/e2e/plugins/tekton/tekton.spec.ts",
      ],
    },
    {
      name: "showcase-rbac",
      testMatch: [
        "**/playwright/e2e/plugins/rbac/**/*.spec.ts",
        "**/playwright/e2e/plugins/analytics/analytics-disabled-rbac.spec.ts",
        "**/playwright/e2e/verify-tls-config-with-external-postgres-db.spec.ts",
        "**/playwright/e2e/plugins/bulk-import.spec.ts",
      ],
    },
    {
      name: "showcase-auth-providers",
      testMatch: ["**/playwright/e2e/authProviders/*.spec.ts"],
      testIgnore: [
        "**/playwright/e2e/authProviders/setup-environment.spec.ts",
        "**/playwright/e2e/authProviders/clear-environment.spec.ts",
        "**/playwright/e2e/verify-tls-config-health-check.spec.ts",
      ],
      dependencies: ["showcase-auth-providers-setup-environment"],
      teardown: "showcase-auth-providers-clear-environment",
      retries: 1,
    },
    {
      name: "showcase-auth-providers-setup-environment",
      testMatch: ["**/playwright/e2e/authProviders/setup-environment.spec.ts"],
    },
    {
      name: "showcase-auth-providers-clear-environment",
      testMatch: ["**/playwright/e2e/authProviders/clear-environment.spec.ts"],
    },
    {
      name: "showcase-k8s",
      ...k8sSpecificConfig,
      dependencies: ["smoke-test"],
      testIgnore: [
        "**/playwright/e2e/smoke-test.spec.ts",
        "**/playwright/e2e/plugins/rbac/**/*.spec.ts",
        "**/playwright/e2e/plugins/analytics/analytics-disabled-rbac.spec.ts",
        "**/playwright/e2e/verify-tls-config-with-external-postgres-db.spec.ts",
        "**/playwright/e2e/authProviders/**/*.spec.ts",
        "**/playwright/e2e/plugins/bulk-import.spec.ts",
        "**/playwright/e2e/plugins/tekton/tekton.spec.ts",
        "**/playwright/e2e/catalog-scaffoldedfromLink.spec.ts",
        "**/playwright/e2e/plugins/ocm.spec.ts",
        "**/playwright/e2e/audit-log/**/*.spec.ts",
        "**/playwright/e2e/verify-redis-cache.spec.ts",
        "**/playwright/e2e/verify-tls-config-health-check.spec.ts",
        "**/playwright/e2e/configuration-test/config-map.spec.ts",
      ],
    },
    {
      name: "showcase-rbac-k8s",
      ...k8sSpecificConfig,
      dependencies: ["smoke-test"],
      testMatch: [
        "**/playwright/e2e/plugins/rbac/**/*.spec.ts",
        "**/playwright/e2e/plugins/analytics/analytics-disabled-rbac.spec.ts",
        "**/playwright/e2e/plugins/bulk-import.spec.ts",
      ],
    },
    {
      name: "showcase-operator",
      testIgnore: [
        "**/playwright/e2e/plugins/rbac/**/*.spec.ts",
        "**/playwright/e2e/plugins/analytics/analytics-disabled-rbac.spec.ts",
        "**/playwright/e2e/verify-tls-config-with-external-postgres-db.spec.ts",
        "**/playwright/e2e/authProviders/**/*.spec.ts",
        "**/playwright/e2e/plugins/bulk-import.spec.ts",
        "**/playwright/e2e/plugins/tekton/tekton.spec.ts",
        "**/playwright/e2e/catalog-scaffoldedfromLink.spec.ts",
        "**/playwright/e2e/audit-log/**/*.spec.ts",
        "**/playwright/e2e/plugins/topology/topology.spec.ts",
        "**/playwright/e2e/verify-tls-config-health-check.spec.ts",
        "**/playwright/e2e/configuration-test/config-map.spec.ts",
      ],
    },
    {
      name: "showcase-operator-rbac",
      testMatch: [
        "**/playwright/e2e/plugins/rbac/**/*.spec.ts",
        "**/playwright/e2e/plugins/analytics/analytics-disabled-rbac.spec.ts",
        "**/playwright/e2e/plugins/bulk-import.spec.ts",
      ],
    },
    {
      name: "showcase-runtime",
      testMatch: [
        "**/playwright/e2e/configuration-test/config-map.spec.ts",
        "**/playwright/e2e/verify-tls-config-health-check.spec.ts",
      ],
    },

    {
      name: "showcase-sanity-plugins",
      testMatch: [
        "**/playwright/e2e/catalog-timestamp.spec.ts",
        "**/playwright/e2e/plugins/frontend/sidebar.spec.ts",
        "**/playwright/e2e/home-page-customization.spec.ts",
        "**/playwright/e2e/instance-health-check.spec.ts",
      ],
    },
    {
      name: "any-test",
      testMatch: "**/*.spec.ts", // Allows running any test file
    },
  ],
});
