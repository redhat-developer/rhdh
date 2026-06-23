import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "node", "promise"],
  categories: {
    correctness: "error",
    suspicious: "error",
    pedantic: "error",
  },
  options: {
    typeAware: true,
    typeCheck: true,
  },
  jsPlugins: ["eslint-plugin-playwright", "eslint-plugin-check-file"],
  ignorePatterns: [
    "node_modules/**",
    "playwright-report/**",
    "test-results/**",
    "coverage/**",
    ".local-test/**",
    "scripts/**",
  ],
  rules: {
    "typescript/no-floating-promises": "error",
    "typescript/await-thenable": "error",
    "typescript/no-unsafe-assignment": "error",
    "typescript/no-unsafe-member-access": "error",
    "typescript/no-unsafe-call": "error",
    "typescript/no-unsafe-return": "error",
    "typescript/strict-void-return": "error",
    "typescript/prefer-readonly-parameter-types": "off",
    "check-file/filename-naming-convention": [
      "error",
      {
        "**/*.{js,ts,jsx,tsx}": "KEBAB_CASE",
      },
      {
        ignoreMiddleExtensions: true,
      },
    ],
    "check-file/folder-naming-convention": [
      "error",
      {
        "**": "KEBAB_CASE",
      },
    ],
    "playwright/no-wait-for-timeout": "error",
    "playwright/no-force-option": "error",
    "playwright/expect-expect": "error",
    "playwright/valid-expect": "error",
    "playwright/prefer-native-locators": "error",
    "playwright/no-raw-locators": [
      "error",
      {
        allowed: [],
      },
    ],
    "playwright/no-skipped-test": [
      "error",
      {
        allowConditional: true,
      },
    ],
  },
  overrides: [
    {
      files: ["playwright/e2e/auth-providers/**/*.spec.ts"],
      rules: {
        "typescript/strict-void-return": "off",
        "typescript/no-misused-promises": "off",
      },
    },
    {
      files: ["**/*.spec.ts", "**/*.test.ts"],
      rules: {
        "eslint/max-lines": "off",
        "eslint/max-lines-per-function": "off",
      },
    },
    {
      files: [
        "playwright/utils/kube-client.ts",
        "playwright/utils/kube-client-*.ts",
        "playwright/utils/common.ts",
        "playwright/utils/common-auth-popup.ts",
        "playwright/utils/ui-helper.ts",
        "playwright/utils/ui-helper/**/*.ts",
        "playwright/utils/api-helper.ts",
        "playwright/utils/postgres-config.ts",
        "playwright/utils/authentication-providers/rhdh-deployment.ts",
        "playwright/utils/authentication-providers/rhdh-deployment-*.ts",
        "playwright/utils/authentication-providers/msgraph-helper.ts",
        "playwright/utils/authentication-providers/msgraph-helper-nsg.ts",
        "playwright/e2e/audit-log/log-utils.ts",
        "playwright/e2e/plugin-division-mode-schema/schema-mode-setup.ts",
        "playwright/e2e/plugin-division-mode-schema/schema-mode-db.ts",
        "playwright/support/selectors/semantic-selectors*.ts",
        "playwright/data/rbac-constants.ts",
      ],
      rules: {
        "eslint/max-lines": "off",
        "eslint/max-lines-per-function": "off",
        "eslint/max-depth": "off",
      },
    },
    {
      files: ["playwright/e2e/localization/locale.ts"],
      rules: {
        "import/max-dependencies": "off",
      },
    },
    {
      files: ["playwright/utils/kube-client.ts"],
      rules: {
        "import/max-dependencies": "off",
      },
    },
    {
      files: ["playwright/utils/authentication-providers/rhdh-deployment.ts"],
      rules: {
        "import/max-dependencies": "off",
      },
    },
    {
      files: ["**/*.spec.ts", "**/*.test.ts", "playwright/**/*.ts"],
      rules: {
        // Playwright requires object destructuring for hook/test callbacks that take
        // testInfo as a second argument (e.g. async ({}, testInfo) =>). Oxlint's
        // no-empty-pattern rejects {}; disable it here so lint and runtime agree.
        "eslint/no-empty-pattern": "off",
        "playwright/valid-title": "off",
        "playwright/valid-describe-callback": "off",
        "playwright/no-wait-for-selector": "off",
        "playwright/expect-expect": [
          "error",
          {
            assertFunctionNames: [
              "expect",
              "toPass",
              "verifyHeading",
              "verifyQuickAccess",
              "verifyLink",
              "verifyRowsInTable",
              "verifyRowInTableByUniqueText",
              "verifyDivHasText",
              "verifyComponentInCatalog",
              "verifyParagraph",
              "verifyText",
              "verifyTextinCard",
              "verifyVisitedCardContent",
              "verifyAboutCardIsDisplayed",
              "verifyPRStatisticsRendered",
              "verifyPRRows",
              "verifyPRRowsPerPage",
              "registerExistingComponent",
              "inspectEntityAndVerifyYaml",
              "runAccessibilityTests",
              "validateLog",
              "validateLogEvent",
              "validateRbacLogEvent",
              "checkRbacResponse",
              "verifyTextInSelector",
              "verifyPartialTextInSelector",
              "loginAsGuest",
              "waitForTitle",
            ],
          },
        ],
      },
    },
  ],
});
