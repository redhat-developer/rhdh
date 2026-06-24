import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: [
    "eslint",
    "typescript",
    "unicorn",
    "oxc",
    "import",
    "node",
    "promise",
  ],
  categories: {
    correctness: "error",
    suspicious: "error",
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
  ],
  rules: {
    "typescript/no-floating-promises": "error",
    "typescript/await-thenable": "error",
    "typescript/no-unsafe-assignment": "error",
    "typescript/no-unsafe-member-access": "error",
    "typescript/no-unsafe-call": "error",
    "typescript/no-unsafe-return": "error",
    "typescript/strict-void-return": "error",
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
