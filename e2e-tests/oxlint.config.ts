import { defineConfig } from "oxlint";

export default defineConfig({
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
    "playwright/expect-expect": "warn",
    "playwright/valid-expect": "error",
    "playwright/prefer-native-locators": "warn",
    "playwright/no-raw-locators": [
      "warn",
      {
        allowed: [],
      },
    ],
    "playwright/no-skipped-test": [
      "warn",
      {
        allowConditional: true,
      },
    ],
  },
  overrides: [
    {
      files: ["**/*.spec.ts", "**/*.test.ts", "playwright/**/*.ts"],
      rules: {
        "playwright/valid-title": "off",
        "playwright/valid-describe-callback": "off",
        "playwright/no-wait-for-selector": "off",
      },
    },
  ],
});
