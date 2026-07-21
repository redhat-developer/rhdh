import { defineConfig, devices } from "@playwright/test";
import type { ReporterDescription } from "@playwright/test";

/* oxlint-disable import/no-unassigned-import -- intentional side-effect graph wiring */
import "./playwright/entry-graph";
import { PW_PROJECT } from "./playwright/projects";

process.env.JOB_NAME = process.env.JOB_NAME ?? "";
process.env.IS_OPENSHIFT = process.env.IS_OPENSHIFT ?? "";

// Set LOCALE based on which project is being run
const args = process.argv;

if (args.some((arg) => arg.includes(PW_PROJECT.SHOWCASE_LOCALIZATION_DE))) {
  process.env.LOCALE = "de";
} else if (args.some((arg) => arg.includes(PW_PROJECT.SHOWCASE_LOCALIZATION_ES))) {
  process.env.LOCALE = "es";
} else if (args.some((arg) => arg.includes(PW_PROJECT.SHOWCASE_LOCALIZATION_FR))) {
  process.env.LOCALE = "fr";
} else if (args.some((arg) => arg.includes(PW_PROJECT.SHOWCASE_LOCALIZATION_IT))) {
  process.env.LOCALE = "it";
} else if (args.some((arg) => arg.includes(PW_PROJECT.SHOWCASE_LOCALIZATION_JA))) {
  process.env.LOCALE = "ja";
} else if (process.env.LOCALE === undefined || process.env.LOCALE === "") {
  process.env.LOCALE = "en";
}

const k8sSpecificConfig = {
  use: {
    actionTimeout: 15 * 1000,
  },
  // Global expect timeout
  expect: {
    timeout: 15 * 1000,
  },
};

export default defineConfig({
  globalSetup: "./playwright/global-setup.ts",
  timeout: 90 * 1000,
  testDir: "./playwright/e2e",
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: process.env.CI !== undefined && process.env.CI !== "",
  /* Retry on CI only */
  retries: process.env.CI !== undefined && process.env.CI !== "" ? 2 : 0,
  /* Keep a small shared worker pool; stateful projects override this to 1. */
  workers: process.env.CI !== undefined && process.env.CI !== "" ? 3 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  // Coverage reporter (RHIDP-13243) is appended only when COLLECT_COVERAGE=true;
  // otherwise it is not registered at all and the default reporters run alone.
  reporter: [
    ["html"],
    ["list"],
    ["junit", { outputFile: process.env.JUNIT_RESULTS ?? "junit-results.xml" }],
    ...(process.env.COLLECT_COVERAGE === "true"
      ? ([["./playwright/support/coverage/reporter.ts"]] satisfies ReporterDescription[])
      : []),
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    locale: process.env.LOCALE ?? "en",
    baseURL: process.env.BASE_URL,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "on",
    ...devices["Desktop Chrome"],
    viewport: { width: 1920, height: 1080 },
    // Note: this video config only applies to tests using the built-in { page } fixture.
    // Tests that share one browser context across a describe block should use
    // the worker-scoped rhdhPage / rhdhContext fixtures from @support/coverage/test.
    video: {
      mode: "retain-on-failure",
      size: { width: 1280, height: 720 },
    },
    actionTimeout: 10 * 1000,
    navigationTimeout: 50 * 1000,
  },
  // Global expect timeout
  expect: {
    timeout: 10 * 1000,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: PW_PROJECT.SMOKE_TEST,
      testMatch: "**/playwright/e2e/smoke-test.spec.ts",
    },
    {
      name: PW_PROJECT.SHOWCASE,
      timeout: 180 * 1000,
      dependencies: [PW_PROJECT.SMOKE_TEST],
      testIgnore: [
        "**/playwright/seed.spec.ts",
        "**/playwright/e2e/plugins/rbac/**/*.spec.ts",
        "**/playwright/e2e/**/*-rbac.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-crunchy.spec.ts",
        "**/playwright/e2e/auth-providers/**/*.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-rds.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-azure-db.spec.ts",
        "**/playwright/e2e/plugin-division-mode-schema/*.spec.ts",
        "**/playwright/e2e/configuration-test/config-map.spec.ts",
        "**/playwright/e2e/plugin-dynamic-loading.spec.ts",
      ],
    },
    {
      name: PW_PROJECT.SHOWCASE_RBAC,
      dependencies: [PW_PROJECT.SMOKE_TEST],
      testMatch: [
        "**/playwright/e2e/**/*-rbac.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-crunchy.spec.ts",
      ],
    },
    {
      name: PW_PROJECT.SHOWCASE_AUTH_PROVIDERS,
      timeout: 600 * 1000,
      testMatch: ["**/playwright/e2e/auth-providers/*.spec.ts"],
      testIgnore: [
        // temporarily disable github-happy-path
        "**/playwright/e2e/auth-providers/github-happy-path.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-rds.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-azure-db.spec.ts",
      ],
      retries: 1,
    },
    {
      name: PW_PROJECT.SHOWCASE_K8S,
      ...k8sSpecificConfig,
      dependencies: [PW_PROJECT.SMOKE_TEST],
      testIgnore: [
        "**/playwright/seed.spec.ts",
        "**/playwright/e2e/smoke-test.spec.ts",
        "**/playwright/e2e/plugins/rbac/**/*.spec.ts",
        "**/playwright/e2e/**/*-rbac.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-crunchy.spec.ts",
        "**/playwright/e2e/auth-providers/**/*.spec.ts",
        "**/playwright/e2e/plugins/scaffolder-backend-module-annotator/**/*.spec.ts",
        "**/playwright/e2e/plugins/scaffolder-relation-processor/**/*.spec.ts",
        "**/playwright/e2e/plugins/ocm.spec.ts",
        "**/playwright/e2e/audit-log/**/*.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-rds.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-azure-db.spec.ts",
        "**/playwright/e2e/configuration-test/config-map.spec.ts",
        "**/playwright/e2e/github-happy-path.spec.ts",
        "**/playwright/e2e/plugin-division-mode-schema/*.spec.ts",
        "**/playwright/e2e/plugin-dynamic-loading.spec.ts",
      ],
    },
    {
      name: PW_PROJECT.SHOWCASE_RBAC_K8S,
      ...k8sSpecificConfig,
      dependencies: [PW_PROJECT.SMOKE_TEST],
      testMatch: ["**/playwright/e2e/**/*-rbac.spec.ts"],
    },
    {
      name: PW_PROJECT.SHOWCASE_OPERATOR,
      dependencies: [PW_PROJECT.SMOKE_TEST],
      testIgnore: [
        "**/playwright/seed.spec.ts",
        "**/playwright/e2e/plugins/rbac/**/*.spec.ts",
        "**/playwright/e2e/**/*-rbac.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-crunchy.spec.ts",
        "**/playwright/e2e/auth-providers/**/*.spec.ts",
        "**/playwright/e2e/plugins/scaffolder-backend-module-annotator/**/*.spec.ts",
        "**/playwright/e2e/plugins/scaffolder-relation-processor/**/*.spec.ts",
        "**/playwright/e2e/audit-log/**/*.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-rds.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-azure-db.spec.ts",
        "**/playwright/e2e/configuration-test/config-map.spec.ts",
        "**/playwright/e2e/github-happy-path.spec.ts",
        "**/playwright/e2e/plugin-division-mode-schema/*.spec.ts",
        "**/playwright/e2e/plugin-dynamic-loading.spec.ts",
      ],
    },
    {
      name: PW_PROJECT.SHOWCASE_OPERATOR_RBAC,
      dependencies: [PW_PROJECT.SMOKE_TEST],
      testMatch: ["**/playwright/e2e/**/*-rbac.spec.ts"],
    },
    {
      name: PW_PROJECT.SHOWCASE_RUNTIME,
      workers: 1,
      timeout: 10 * 60 * 1000,
      testMatch: [
        "**/playwright/e2e/configuration-test/config-map.spec.ts",
        "**/playwright/e2e/plugin-division-mode-schema/verify-schema-mode.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-rds.spec.ts",
        "**/playwright/e2e/external-database/verify-tls-config-with-external-azure-db.spec.ts",
      ],
    },

    {
      name: PW_PROJECT.SHOWCASE_SANITY_PLUGINS,
      dependencies: [PW_PROJECT.SMOKE_TEST],
      testMatch: [
        "**/playwright/e2e/catalog-timestamp.spec.ts",
        "**/playwright/e2e/home-page-customization.spec.ts",
        "**/playwright/e2e/plugins/frontend/sidebar.spec.ts",
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
      testMatch: ["**/playwright/e2e/home-page-customization.spec.ts"],
    },
    {
      name: PW_PROJECT.SHOWCASE_LOCALIZATION_DE,
      dependencies: [PW_PROJECT.SMOKE_TEST],
      use: {
        locale: "de",
      },
      testMatch: [
        "**/playwright/e2e/catalog-timestamp.spec.ts",
        "**/playwright/e2e/plugins/frontend/sidebar.spec.ts",
        "**/playwright/e2e/settings.spec.ts",
      ],
    },
    {
      name: PW_PROJECT.SHOWCASE_LOCALIZATION_ES,
      dependencies: [PW_PROJECT.SMOKE_TEST],
      use: {
        locale: "es",
      },
      testMatch: [
        "**/playwright/e2e/catalog-timestamp.spec.ts",
        "**/playwright/e2e/plugins/frontend/sidebar.spec.ts",
        "**/playwright/e2e/settings.spec.ts",
      ],
    },
    {
      name: PW_PROJECT.SHOWCASE_LOCALIZATION_FR,
      dependencies: [PW_PROJECT.SMOKE_TEST],
      use: {
        locale: "fr",
      },
      testMatch: [
        "**/playwright/e2e/catalog-timestamp.spec.ts",
        "**/playwright/e2e/plugins/frontend/sidebar.spec.ts",
        "**/playwright/e2e/settings.spec.ts",
      ],
    },
    {
      name: PW_PROJECT.SHOWCASE_LOCALIZATION_IT,
      dependencies: [PW_PROJECT.SMOKE_TEST],
      use: {
        locale: "it",
      },
      testMatch: [
        "**/playwright/e2e/catalog-timestamp.spec.ts",
        "**/playwright/e2e/plugins/frontend/sidebar.spec.ts",
        "**/playwright/e2e/settings.spec.ts",
      ],
    },
    {
      name: PW_PROJECT.SHOWCASE_LOCALIZATION_JA,
      dependencies: [PW_PROJECT.SMOKE_TEST],
      use: {
        locale: "ja",
      },
      testMatch: [
        "**/playwright/e2e/catalog-timestamp.spec.ts",
        "**/playwright/e2e/plugins/frontend/sidebar.spec.ts",
        "**/playwright/e2e/settings.spec.ts",
      ],
    },
  ],
});
