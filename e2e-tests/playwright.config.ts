import { defineConfig, devices } from "@playwright/test";

process.env.JOB_NAME = process.env.JOB_NAME || "";
process.env.IS_OPENSHIFT = process.env.IS_OPENSHIFT || "";

// Set LOCALE based on which project is being run
const args = process.argv;

if (args.some((arg) => arg.includes("showcase-localization-fr"))) {
  process.env.LOCALE = "fr";
} else if (!process.env.LOCALE) {
  process.env.LOCALE = "en";
}

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
    ["junit", { outputFile: process.env.JUNIT_RESULTS || "junit-results.xml" }],
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    locale: process.env.LOCALE || "en",
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
      dependencies: ["smoke-test"],
      testIgnore: [
        "**/playwright/e2e/plugins/rbac/**/*.spec.ts",
        "**/playwright/e2e/**/*-rbac.spec.ts",
        "**/playwright/e2e/verify-tls-config-with-external-postgres-db.spec.ts",
        "**/playwright/e2e/auth-providers/**/*.spec.ts",
        "**/playwright/e2e/plugins/bulk-import.spec.ts",
        "**/playwright/e2e/verify-tls-config-health-check.spec.ts",
        "**/playwright/e2e/configuration-test/config-map.spec.ts",
        "**/playwright/e2e/plugins/tekton/tekton.spec.ts",
        "**/playwright/e2e/dynamic-home-page-customization.spec.ts",
        "**/playwright/e2e/plugins/scorecard/scorecard.spec.ts",
      ],
    },
    {
      name: "showcase-rbac",
      dependencies: ["smoke-test"],
      testMatch: [
        "**/playwright/e2e/plugins/rbac/**/*.spec.ts",
        "**/playwright/e2e/**/*-rbac.spec.ts",
        "**/playwright/e2e/verify-tls-config-with-external-postgres-db.spec.ts",
        "**/playwright/e2e/plugins/bulk-import.spec.ts",
        "**/playwright/e2e/plugins/quick-start.spec.ts",
        "**/playwright/e2e/plugins/scorecard/scorecard.spec.ts",
      ],
    },
    {
      name: "showcase-auth-providers",
      testMatch: ["**/playwright/e2e/auth-providers/*.spec.ts"],
      testIgnore: [
        "**/playwright/e2e/auth-providers/github-happy-path.spec.ts", // temporarily disable
        "**/playwright/e2e/verify-tls-config-health-check.spec.ts",
        "**/playwright/e2e/dynamic-home-page-customization.spec.ts",
      ],
      retries: 1,
    },
    {
      name: "showcase-k8s",
      ...k8sSpecificConfig,
      dependencies: ["smoke-test"],
      testIgnore: [
        "**/playwright/e2e/smoke-test.spec.ts",
        "**/playwright/e2e/plugins/rbac/**/*.spec.ts",
        "**/playwright/e2e/**/*-rbac.spec.ts",
        "**/playwright/e2e/verify-tls-config-with-external-postgres-db.spec.ts",
        "**/playwright/e2e/auth-providers/**/*.spec.ts",
        "**/playwright/e2e/plugins/bulk-import.spec.ts",
        "**/playwright/e2e/plugins/tekton/tekton.spec.ts",
        "**/playwright/e2e/scaffolder-backend-module-annotator.spec.ts",
        "**/playwright/e2e/plugins/ocm.spec.ts",
        "**/playwright/e2e/audit-log/**/*.spec.ts",
        "**/playwright/e2e/verify-tls-config-health-check.spec.ts",
        "**/playwright/e2e/configuration-test/config-map.spec.ts",
        "**/playwright/e2e/github-happy-path.spec.ts",
        "**/playwright/e2e/dynamic-home-page-customization.spec.ts",
        "**/playwright/e2e/plugins/scorecard/scorecard.spec.ts",
      ],
    },
    {
      name: "showcase-rbac-k8s",
      ...k8sSpecificConfig,
      dependencies: ["smoke-test"],
      testMatch: [
        "**/playwright/e2e/plugins/rbac/**/*.spec.ts",
        "**/playwright/e2e/**/*-rbac.spec.ts",
        "**/playwright/e2e/plugins/bulk-import.spec.ts",
        "**/playwright/e2e/plugins/scorecard/scorecard.spec.ts",
      ],
    },
    {
      name: "showcase-operator",
      dependencies: ["smoke-test"],
      testIgnore: [
        "**/playwright/e2e/plugins/rbac/**/*.spec.ts",
        "**/playwright/e2e/**/*-rbac.spec.ts",
        "**/playwright/e2e/verify-tls-config-with-external-postgres-db.spec.ts",
        "**/playwright/e2e/auth-providers/**/*.spec.ts",
        "**/playwright/e2e/plugins/bulk-import.spec.ts",
        "**/playwright/e2e/plugins/tekton/tekton.spec.ts",
        "**/playwright/e2e/scaffolder-backend-module-annotator.spec.ts",
        "**/playwright/e2e/audit-log/**/*.spec.ts",
        "**/playwright/e2e/verify-tls-config-health-check.spec.ts",
        "**/playwright/e2e/configuration-test/config-map.spec.ts",
        "**/playwright/e2e/github-happy-path.spec.ts",
        "**/playwright/e2e/dynamic-home-page-customization.spec.ts",
        "**/playwright/e2e/plugins/scorecard/scorecard.spec.ts",
      ],
    },
    {
      name: "showcase-operator-rbac",
      dependencies: ["smoke-test"],
      testMatch: [
        "**/playwright/e2e/plugins/rbac/**/*.spec.ts",
        "**/playwright/e2e/**/*-rbac.spec.ts",
        "**/playwright/e2e/plugins/bulk-import.spec.ts",
        "**/playwright/e2e/plugins/scorecard/scorecard.spec.ts",
      ],
    },
    {
      name: "showcase-runtime",
      dependencies: ["smoke-test"],
      testMatch: [
        "**/playwright/e2e/configuration-test/config-map.spec.ts",
        "**/playwright/e2e/verify-tls-config-health-check.spec.ts",
      ],
    },

    {
      name: "showcase-sanity-plugins",
      dependencies: ["smoke-test"],
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
    {
      name: "showcase-upgrade",
      dependencies: ["smoke-test"],
      testMatch: [
        "**/playwright/e2e/home-page-customization.spec.ts",
        "**/playwright/e2e/plugins/quick-access-and-tech-radar.spec.ts",
      ],
    },
    {
      name: "showcase-localization-fr",
      use: {
        locale: "fr",
      },
      testMatch: [
        "**/playwright/e2e/extensions.spec.ts",
        "**/playwright/e2e/default-global-header.spec.ts",
        "**/playwright/e2e/catalog-timestamp.spec.ts",
        "**/playwright/e2e/custom-theme.spec.ts",
        "**/playwright/e2e/plugins/frontend/sidebar.spec.ts",
        "**/playwright/e2e/settings.spec.ts",
      ],
    },
  ],
});
