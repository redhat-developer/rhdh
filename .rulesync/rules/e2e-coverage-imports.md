---
root: false
targets:
  - '*'
globs:
  - e2e-tests/playwright/**/*.spec.ts
  - e2e-tests/playwright/**/*.test.ts
---
# E2E Coverage: Use Instrumented Imports

When creating or modifying Playwright spec files under `e2e-tests/playwright/`, always use the coverage-instrumented `test` and `expect` instead of importing directly from `@playwright/test`.

## Import Rule

```typescript
// WRONG - bypasses coverage collection
import { test, expect } from "@playwright/test";

// CORRECT - uses the @support path alias (configured in e2e-tests/tsconfig.json)
import { test, expect } from "@support/coverage/test";
```

The instrumented version is a drop-in replacement: `describe`, `beforeAll`, `expect`, locators, and all fixtures behave identically. When `COLLECT_COVERAGE` is unset (the default), the instrumented fixture is a no-op with zero overhead.

## Specs with Custom Context

If the spec creates its own `BrowserContext` / `Page` via `browser.newContext()`, also import and call the explicit helpers:

```typescript
import { test, expect, startCoverageForPage, stopCoverageForPage } from "@support/coverage/test";

test("my test", async ({}, testInfo) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await startCoverageForPage(page);
  try {
    // test body
  } finally {
    await stopCoverageForPage(page, testInfo);
  }
});
```

## Reference

See `docs/coverage/e2e-rhdh.md` for full details on the coverage infrastructure.
