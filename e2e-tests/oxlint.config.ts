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
    "vitest",
  ],
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
  },
  overrides: [
    {
      // Auth-provider specs deploy RHDH in beforeAll and use async Playwright hooks.
      // strict-void-return and no-misused-promises produce false positives on those
      // describe/beforeAll callbacks without improving test safety.
      files: ["playwright/e2e/auth-providers/**/*.spec.ts"],
      rules: {
        "typescript/strict-void-return": "off",
        "typescript/no-misused-promises": "off",
      },
    },
    {
      // Spec and unit files orchestrate multi-step flows; length limits target
      // production code readability, not test scenarios.
      files: ["**/*.spec.ts", "**/*.test.ts"],
      rules: {
        "eslint/max-lines": "off",
        "eslint/max-lines-per-function": "off",
      },
    },
    {
      // Shared infrastructure (utils, support, data, e2e helpers) is split into
      // modules but still contains cohesive orchestration (kube waits, deployment
      // setup, log parsing). Complexity limits would force artificial fragmentation.
      files: [
        "playwright/utils/**/*.ts",
        "playwright/support/**/*.ts",
        "playwright/data/**/*.ts",
        "playwright/e2e/**/*.ts",
      ],
      rules: {
        "eslint/max-lines": "off",
        "eslint/max-lines-per-function": "off",
        "eslint/max-depth": "off",
      },
    },
    {
      // Facade modules aggregate many submodules by design (e.g. KubeClient re-exports,
      // rhdh-deployment orchestration, locale translation maps). A flat import count
      // does not reflect coupling when each import is a focused submodule.
      files: [
        "playwright/utils/**/*.ts",
        "playwright/e2e/localization/**/*.ts",
      ],
      rules: {
        "import/max-dependencies": "off",
      },
    },
    {
      // Playwright E2E specs only (*.spec.ts under playwright/e2e).
      files: ["**/*.spec.ts"],
      rules: {
        "playwright/no-wait-for-timeout": "error",
        "playwright/no-force-option": "error",
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
              "verifyWelcomeHeading",
              "verifyGuestProfile",
              "verifySignInPageTitle",
              "verifyProfileHeading",
              "verifySignInError",
              "verifyQuickAccess",
              "verifyLink",
              "verifyRowsInTable",
              "verifyRowInTableByUniqueText",
              "verifyDivHasText",
              "verifyComponentInCatalog",
              "verifyComponentsInCatalog",
              "verifyParagraph",
              "verifyText",
              "verifyTextinCard",
              "verifyTextInCard",
              "verifyVisitedCardContent",
              "verifyAboutCardIsDisplayed",
              "verifyPRStatisticsRendered",
              "verifyPRRows",
              "verifyPRRowsPerPage",
              "waitForEntityPath",
              "clickPullRequestFilter",
              "verifyGithubUserProfile",
              "verifySignInButtonVisible",
              "verifyTemplateHeading",
              "verifyTableCell",
              "verifyDependencyResource",
              "verifySharedCardCount",
              "incrementFirstCardCounter",
              "waitForOpenInCatalogLink",
              "verifyComponentNameVisible",
              "verifyLinkHidden",
              "clearSearchIfVisible",
              "sortCreatedAtDescending",
              "verifyFirstRowCreatedAtNotEmpty",
              "openLicensedUsersCatalog",
              "verifyTestPageContent",
              "verifyContextOneCard",
              "verifyContextTwoCard",
              "verifyTemplatesHeading",
              "verifyDocumentationHeading",
              "verifyDocHeading",
              "verifyCreateReactAppReviewTableWithGroupOwner",
              "verifyDependencyGraphLabels",
              "launchTemplateAndVerifyIntro",
              "runHttpRequestTemplateFlow",
              "inspectEntityAndVerifyYaml",
              "registerExistingComponent",
              "inspectEntityAndVerifyYaml",
              "runAccessibilityTests",
              "validateLog",
              "validateLogEvent",
              "validateRbacLogEvent",
              "checkRbacResponse",
              "verifyTextInSelector",
              "verifyPartialTextInSelector",
              "verifyTextVisible",
              "verifyLanguageToggleList",
              "verifyLanguageSelectShowsOptions",
              "verifyLanguageOptionsList",
              "verifySelectedLanguage",
              "verifySignOutMenuLabel",
              "verifySidebarMenuItemHidden",
              "verifyLocalizedUserSettingsLabelsWithOwnership",
              "verifyBuildInfoCardVisible",
              "verifyBuildInfoText",
              "verifyGuestSignInMethodNotListed",
              "verifyInactivityLogoutMessageHidden",
              "verifyRhdhMetadata",
              "verifyMenuItemInSection",
              "verifyLearningPathLinksOpenInNewTab",
              "verifyMainHeadingVisible",
              "loginAsGuest",
              "restartDeployment",
              "waitForTitle",
            ],
          },
        ],
      },
    },
    {
      // Vitest plugin is enabled repo-wide but rules apply only to unit tests.
      files: ["**/*.spec.ts"],
      rules: {
        "vitest/expect-expect": "off",
        "vitest/valid-expect": "off",
        "vitest/no-conditional-in-test": "off",
        "vitest/no-conditional-tests": "off",
      },
    },
    {
      // Vitest unit tests (*.test.ts). E2E uses *.spec.ts + Playwright rules above.
      files: ["**/*.test.ts"],
      rules: {
        "vitest/valid-expect": "off",
        "vitest/expect-expect": "error",
        "vitest/no-conditional-in-test": "off",
        "vitest/no-conditional-tests": "off",
        "eslint/no-empty-pattern": "off",
      },
    },
  ],
});
