import js from "@eslint/js";
import tseslint from "typescript-eslint";
import checkFile from "eslint-plugin-check-file";
import { fileURLToPath } from "url";
import { dirname } from "path";
import playwright from "eslint-plugin-playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "variable",
          format: ["camelCase"],
        },
        {
          selector: "variable",
          modifiers: ["const", "exported"],
          format: ["UPPER_CASE"],
        },
        {
          selector: "function",
          format: ["camelCase"],
        },
        {
          selector: "parameter",
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
        {
          selector: "memberLike",
          modifiers: ["private"],
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
        {
          selector: "typeLike",
          format: ["PascalCase"],
        },
        {
          selector: "enumMember",
          format: ["UPPER_CASE"],
        },
        {
          selector: "class",
          format: ["PascalCase"],
        },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
    },
  },
  {
    files: ["**/*.{js,ts,jsx,tsx}"],
    plugins: {
      "check-file": checkFile,
    },
    rules: {
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
  },
  {
    ignores: ["node_modules/**", "playwright-report/**", "test-results/**"],
  },
  // Playwright recommended rules for test files
  {
    ...playwright.configs["flat/recommended"],
    files: ["**/*.spec.ts", "**/*.test.ts", "playwright/**/*.ts"],
    rules: {
      ...playwright.configs["flat/recommended"].rules,
      // Only disable rules that cause errors, keep warnings
      "playwright/expect-expect": "off", // Allow tests without explicit assertions
      "playwright/valid-title": "off", // Allow duplicate prefixes in test titles
      "playwright/valid-describe-callback": "off", // Allow async describe callbacks
      "playwright/valid-expect": "error", // Keep this as error to catch missing matchers
      "playwright/no-wait-for-selector": "off", // Allow wait for selector
      "playwright/no-wait-for-timeout": "off", // Allow wait for timeout
      "playwright/no-skipped-test": [
        "warn",
        {
          allowConditional: true,
        },
      ],
      "no-restricted-syntax": [
        "error",
        // Custom rule to disallow test.describe.fixme() as it's not valid in Playwright
        {
          selector:
            "CallExpression[callee.property.name='fixme'][callee.object.property.name='describe'][callee.object.object.name='test']",
          message:
            "test.describe.fixme() is not valid in Playwright. Use test.fixme() on individual tests instead.",
        },
        {
          selector:
            "CallExpression[callee.name='test'] > ArrowFunctionExpression CallExpression[callee.property.name='fixme'][callee.object.name='test'] > ArrowFunctionExpression.arguments:first-child",
          message:
            "test.fixme() inside a test body should use a boolean condition, not a function. Use: test.fixme(condition) instead of test.fixme(() => condition)",
        },
      ],
    },
  },
];
