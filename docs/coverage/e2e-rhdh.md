# E2E Code Coverage for the RHDH Repository

Jira: [RHIDP-13243](https://issues.redhat.com/browse/RHIDP-13243)
Epic: [RHIDP-13242](https://issues.redhat.com/browse/RHIDP-13242)
Feature: [RHDHPLAN-851](https://issues.redhat.com/browse/RHDHPLAN-851)

## What this is

This document describes how the `e2e-tests/` Playwright suite collects JavaScript
coverage from Chromium while exercising a deployed RHDH instance, and how that
coverage flows to Codecov.

Scope of this mechanism:

- **What it measures**: frontend JS/TS in `packages/app/src/**` and related modules,
  exercised by the Playwright specs in `e2e-tests/playwright/e2e/`.
- **What it does not measure**: backend-only code, code not loaded by the browser
  during the E2E run, plugins delivered as separate OCI images (tracked under
  RHIDP-11866 via CoverPort).

## How it works

1. **Opt-in via env var.** When `COLLECT_COVERAGE=true`, a Playwright fixture
   (`e2e-tests/playwright/support/coverage/test.ts`) extends the base `test`
   and wraps each run with `page.coverage.startJSCoverage()` / `stopJSCoverage()`.
   Raw V8 coverage is persisted per test as JSON under `coverage/e2e-raw/`.
2. **Aggregation at run end.** A Playwright reporter
   (`e2e-tests/playwright/support/coverage/reporter.ts`) reads the raw files at
   `onEnd` and uses `monocart-coverage-reports` to convert V8 output to
   Istanbul format and emit a merged LCOV + HTML report under `coverage/e2e/`.
3. **Codecov upload (CI, follow-up).** A CI step uploads `coverage/e2e/lcov.info`
   to Codecov with the flag `rhdh-e2e-frontend`. This step lands in a follow-up
   PR (see Known Limitations below).

With `COLLECT_COVERAGE` unset (the default), the fixture and reporter are no-ops
and the E2E suite runs identically to the pre-coverage configuration.

## How to use it locally

### Prerequisites

- A deployed RHDH reachable via `BASE_URL`
- `yarn install` completed in `e2e-tests/`
- Node.js 24

### Run a spec with coverage enabled

```bash
cd e2e-tests
COLLECT_COVERAGE=true yarn playwright test playwright/e2e/smoke-test.spec.ts
```

Outputs:

- `e2e-tests/coverage/e2e-raw/` — one JSON file per test run (raw V8 coverage)
- `e2e-tests/coverage/e2e/` — merged report: `lcov.info`, `coverage-summary.json`,
  HTML dashboard at `index.html`

### View the HTML report

```bash
open e2e-tests/coverage/e2e/index.html
```

## Migrating a spec to capture coverage

There are two patterns depending on how the spec manages its browser page.

### Specs that use the built-in `{ page }` fixture (most specs)

Opt in by importing the extended `test`/`expect` from the coverage helper
instead of `@playwright/test`:

```ts
// Before
import { test, expect } from "@playwright/test";

// After — uses the @support path alias (configured in tsconfig.json),
// so the import is the same regardless of file depth:
import { test, expect } from "@support/coverage/test";
```

The rest of the spec stays identical — `describe`, `beforeAll`, `expect`,
locators, and fixtures behave exactly the same.

### Specs that create their own context/page via `browser.newContext()`

Several existing specs (for example `plugins/adoption-insights`,
`plugins/scorecard`) manage their own `BrowserContext` and `Page` in
`beforeAll` instead of using the default `{ page }` fixture. These specs
bypass the auto-instrumented fixture above — they need to call the helpers
explicitly:

```ts
import { test, expect, startCoverageForPage, stopCoverageForPage } from "@support/coverage/test";

test.describe("my feature", () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
  });

  test("something", async ({}, testInfo) => {
    await startCoverageForPage(page);
    try {
      // test body ...
    } finally {
      await stopCoverageForPage(page, testInfo);
    }
  });
});
```

`startCoverageForPage` and `stopCoverageForPage` are safe to call
unconditionally — they are no-ops when `COLLECT_COVERAGE` is unset, and any
internal failure is logged rather than propagated so coverage collection
cannot fail a test.

### Specs that have not migrated

Run normally and simply do not contribute to coverage data. Migration is
phased by design — this PR lands the scaffolding; spec migration happens
incrementally in follow-up PRs so each batch can be reviewed in isolation.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `COLLECT_COVERAGE` | (unset) | Set to `true` to enable coverage collection |
| `COVERAGE_OUTPUT_DIR` | `<cwd>/coverage/e2e-raw` | Where per-test raw V8 coverage is written |
| `COVERAGE_REPORT_DIR` | `<cwd>/coverage/e2e` | Where the merged Istanbul report is written |
| `COVERAGE_GENERATE_TIMEOUT_MS` | `120000` (2 min) | Maximum time the reporter will wait for `monocart.CoverageReport.generate()` before aborting. Prevents a CI job from hanging if coverage aggregation stalls |

Raw coverage file names include the spec title path, worker index, and retry
number (for example `Smoke_test_basic_flow-w0-r0-1714003200000.json`) so
parallel workers and retries never overwrite each other's output.

## Known limitations

- **Chromium only.** `page.coverage` is a CDP feature and is not available in
  Firefox or WebKit. Chromium is the default browser for this suite, so this
  is not a practical issue today.
- **Source maps required for navigable reports.** The deployed RHDH must ship
  source maps (or an equivalent mapping) for the report to link back to original
  source. If source maps are missing, coverage still works but will point to
  minified bundles. Validating source-map availability in the deployed image is
  a task in RHIDP-13243.
- **CI upload not wired yet.** This PR lands the collection + aggregation
  infrastructure. The Codecov upload step in the Playwright CI jobs (handle_ocp_pull,
  handle_ocp_nightly) is a follow-up task.
- **Specs not yet migrated.** This PR does not modify any existing spec. A
  follow-up PR migrates specs to the extended `test` import so they start
  contributing coverage data.

## Related coverage flags in Codecov

| Flag | Source | Scope |
|---|---|---|
| `rhdh` | Jest (`packages/*`, `plugins/*`) | Unit / integration |
| `install-dynamic-plugins` | Vitest (`scripts/install-dynamic-plugins`) | Install script unit tests |
| `rhdh-e2e-frontend` (new) | Playwright `page.coverage` | E2E frontend — this doc |
| `rhdh-e2e-full` (future) | Instrumented showcase image variant | E2E frontend, higher fidelity (RHIDP-13244) |
| `overlays-e2e-<plugin>` (future) | CoverPort Tekton | Upstream plugins via OCI (RHIDP-11866) |

## References

- Playwright coverage API: https://playwright.dev/docs/api/class-coverage
- monocart-coverage-reports: https://github.com/cenfun/monocart-coverage-reports
- Chrome DevTools Protocol — Coverage domain
- RHDH Test Strategy Proposal (Google Doc): https://docs.google.com/document/d/1B-Jl1uwX3sdWOGqs9CN9rTFYH743q-o5YVMoAz_yPh8/edit
