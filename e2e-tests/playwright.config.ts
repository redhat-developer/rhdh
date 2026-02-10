import { defineConfig, devices } from "@playwright/test";
import { PW_PROJECT } from "./playwright/projects";

process.env.JOB_NAME = process.env.JOB_NAME || "";
process.env.IS_OPENSHIFT = process.env.IS_OPENSHIFT || "";

const isPrOcpHelmJob =
  process.env.JOB_NAME.includes("pull") &&
  process.env.JOB_NAME.includes("e2e-ocp-helm") &&
  !process.env.JOB_NAME.includes("e2e-ocp-helm-nightly");

const isOsdGcpJob = process.env.JOB_NAME.includes("osd-gcp");

const shouldSkipOrchestratorTests = isPrOcpHelmJob || isOsdGcpJob;

// Set LOCALE based on which project is being run
const args = process.argv;

if (args.some((arg) => arg.includes(PW_PROJECT.SHOWCASE_LOCALIZATION_FR))) {
  process.env.LOCALE = "fr";
} else if (
  args.some((arg) => arg.includes(PW_PROJECT.SHOWCASE_LOCALIZATION_IT))
) {
  process.env.LOCALE = "it";
} else if (
  args.some((arg) => arg.includes(PW_PROJECT.SHOWCASE_LOCALIZATION_JA))
) {
  process.env.LOCALE = "ja";
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
  timeout: 180 * 1000,
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
    actionTimeout: 20 * 1000,
    navigationTimeout: 80 * 1000,
  },
  expect: {
    timeout: 25 * 1000, // Global expect timeout
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: PW_PROJECT.SMOKE_TEST,
      testMatch: "**/playwright/e2e/smoke-test.spec.ts",
      retries: 10,
    },
    {
      name: PW_PROJECT.SHOWCASE,
      //dependencies: [PW_PROJECT.SMOKE_TEST],
      testIgnore: [
        "**/playwright/e2e/plugins/rbac/**/*.spec.ts",
        "**/playwright/e2e/**/*-rbac.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-crunchy.spec.ts",
        "**/playwright/e2e/auth-providers/**/*.spec.ts",
        "**/playwright/e2e/plugins/bulk-import.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-rds.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-azure-db.spec.ts",
        "**/playwright/e2e/configuration-test/config-map.spec.ts",
        "**/playwright/e2e/plugins/tekton/tekton.spec.ts",
        "**/playwright/e2e/dynamic-home-page-customization.spec.ts",
        "**/playwright/e2e/plugins/scorecard/scorecard.spec.ts",
        ...(shouldSkipOrchestratorTests
          ? ["**/playwright/e2e/plugins/orchestrator/**/*.spec.ts"]
          : []),
      ],
    },
    {
      name: PW_PROJECT.SHOWCASE_RBAC,
      dependencies: [PW_PROJECT.SMOKE_TEST],
      testMatch: [
        "**/playwright/e2e/plugins/rbac/**/*.spec.ts",
        "**/playwright/e2e/**/*-rbac.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-crunchy.spec.ts",
        "**/playwright/e2e/plugins/bulk-import.spec.ts",
        "**/playwright/e2e/plugins/quick-start.spec.ts",
        "**/playwright/e2e/plugins/scorecard/scorecard.spec.ts",
      ],
      testIgnore: [
        ...(shouldSkipOrchestratorTests
          ? ["**/playwright/e2e/plugins/orchestrator/**/*.spec.ts"]
          : []),
      ],
    },
    {
      name: PW_PROJECT.SHOWCASE_AUTH_PROVIDERS,
      testMatch: ["**/playwright/e2e/auth-providers/*.spec.ts"],
      testIgnore: [
        "**/playwright/e2e/auth-providers/github-happy-path.spec.ts", // temporarily disable
        "**/playwright/e2e/external-database/verify-tls-config-with-external-rds.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-azure-db.spec.ts",
        "**/playwright/e2e/dynamic-home-page-customization.spec.ts",
      ],
      retries: 1,
    },
    {
      name: PW_PROJECT.SHOWCASE_K8S,
      ...k8sSpecificConfig,
      dependencies: [PW_PROJECT.SMOKE_TEST],
      testIgnore: [
        "**/playwright/e2e/smoke-test.spec.ts",
        "**/playwright/e2e/plugins/rbac/**/*.spec.ts",
        "**/playwright/e2e/**/*-rbac.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-crunchy.spec.ts",
        "**/playwright/e2e/auth-providers/**/*.spec.ts",
        "**/playwright/e2e/plugins/bulk-import.spec.ts",
        "**/playwright/e2e/plugins/tekton/tekton.spec.ts",
        "**/playwright/e2e/plugins/scaffolder-backend-module-annotator/**/*.spec.ts",
        "**/playwright/e2e/plugins/scaffolder-relation-processor/**/*.spec.ts",
        "**/playwright/e2e/plugins/ocm.spec.ts",
        "**/playwright/e2e/audit-log/**/*.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-rds.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-azure-db.spec.ts",
        "**/playwright/e2e/configuration-test/config-map.spec.ts",
        "**/playwright/e2e/github-happy-path.spec.ts",
        "**/playwright/e2e/dynamic-home-page-customization.spec.ts",
        "**/playwright/e2e/plugins/scorecard/scorecard.spec.ts",
      ],
    },
    {
      name: PW_PROJECT.SHOWCASE_RBAC_K8S,
      ...k8sSpecificConfig,
      dependencies: [PW_PROJECT.SMOKE_TEST],
      testMatch: [
        "**/playwright/e2e/plugins/rbac/**/*.spec.ts",
        "**/playwright/e2e/**/*-rbac.spec.ts",
        "**/playwright/e2e/plugins/bulk-import.spec.ts",
        "**/playwright/e2e/plugins/scorecard/scorecard.spec.ts",
      ],
      testIgnore: ["**/playwright/e2e/plugins/orchestrator/**/*.spec.ts"],
    },
    {
      name: PW_PROJECT.SHOWCASE_OPERATOR,
      dependencies: [PW_PROJECT.SMOKE_TEST],
      testIgnore: [
        "**/playwright/e2e/plugins/rbac/**/*.spec.ts",
        "**/playwright/e2e/**/*-rbac.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-crunchy.spec.ts",
        "**/playwright/e2e/auth-providers/**/*.spec.ts",
        "**/playwright/e2e/plugins/bulk-import.spec.ts",
        "**/playwright/e2e/plugins/tekton/tekton.spec.ts",
        "**/playwright/e2e/plugins/scaffolder-backend-module-annotator/**/*.spec.ts",
        "**/playwright/e2e/plugins/scaffolder-relation-processor/**/*.spec.ts",
        "**/playwright/e2e/audit-log/**/*.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-rds.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-azure-db.spec.ts",
        "**/playwright/e2e/configuration-test/config-map.spec.ts",
        "**/playwright/e2e/github-happy-path.spec.ts",
        "**/playwright/e2e/dynamic-home-page-customization.spec.ts",
        "**/playwright/e2e/plugins/scorecard/scorecard.spec.ts",
      ],
    },
    {
      name: PW_PROJECT.SHOWCASE_OPERATOR_RBAC,
      dependencies: [PW_PROJECT.SMOKE_TEST],
      testMatch: [
        "**/playwright/e2e/plugins/rbac/**/*.spec.ts",
        "**/playwright/e2e/**/*-rbac.spec.ts",
        "**/playwright/e2e/plugins/bulk-import.spec.ts",
        "**/playwright/e2e/plugins/scorecard/scorecard.spec.ts",
      ],
      testIgnore: [
        ...(shouldSkipOrchestratorTests
          ? ["**/playwright/e2e/plugins/orchestrator/**/*.spec.ts"]
          : []),
      ],
    },
    {
      name: PW_PROJECT.SHOWCASE_RUNTIME_DB,
      workers: 1,
      testMatch: [
        "**/playwright/e2e/external-database/verify-tls-config-with-external-rds.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-azure-db.spec.ts",
      ],
    },
    {
      name: PW_PROJECT.SHOWCASE_RUNTIME,
      workers: 1,
      dependencies: [PW_PROJECT.SHOWCASE_RUNTIME_DB],
      testMatch: ["**/playwright/e2e/configuration-test/config-map.spec.ts"],
    },

    {
      name: PW_PROJECT.SHOWCASE_SANITY_PLUGINS,
      dependencies: [PW_PROJECT.SMOKE_TEST],
      testMatch: [
        "**/playwright/e2e/catalog-timestamp.spec.ts",
        "**/playwright/e2e/plugins/frontend/sidebar.spec.ts",
        "**/playwright/e2e/home-page-customization.spec.ts",
        "**/playwright/e2e/instance-health-check.spec.ts",
      ],
    },
    {
      name: PW_PROJECT.ANY_TEST,
      testMatch: "**/*.spec.ts",
    },
    {
      name: PW_PROJECT.SHOWCASE_UPGRADE,
      dependencies: [PW_PROJECT.SMOKE_TEST],
      testMatch: [
        "**/playwright/e2e/home-page-customization.spec.ts",
        "**/playwright/e2e/plugins/quick-access-and-tech-radar.spec.ts",
      ],
    },
    {
      name: PW_PROJECT.SHOWCASE_LOCALIZATION_FR,
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
    {
      name: PW_PROJECT.SHOWCASE_LOCALIZATION_IT,
      use: {
        locale: "it",
      },
      testMatch: [
        "**/playwright/e2e/extensions.spec.ts",
        "**/playwright/e2e/default-global-header.spec.ts",
        "**/playwright/e2e/catalog-timestamp.spec.ts",
        // TODO: RHDHBUGS-2592 - Custom theme spec is not working
        // "**/playwright/e2e/custom-theme.spec.ts",
        "**/playwright/e2e/plugins/frontend/sidebar.spec.ts",
        "**/playwright/e2e/settings.spec.ts",
      ],
    },
    {
      name: PW_PROJECT.SHOWCASE_LOCALIZATION_JA,
      use: {
        locale: "ja",
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
