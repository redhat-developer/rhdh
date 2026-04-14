---
name: e2e-diagnose-and-fix
description: >-
  Analyze a failing E2E test, determine root cause, and fix it using Playwright
  Test Agents and RHDH project conventions
targets:
  - '*'
---
# Diagnose and Fix

Analyze the root cause of a failing E2E test and implement a fix following RHDH project conventions.

## When to Use

Use this skill after reproducing a failure (via `e2e-reproduce-failure`) when you have confirmed the test fails and need to determine the root cause and implement a fix.

## Check for Existing Fix on Main (Release Branches Only)

If the fix branch is based on a **release branch** (e.g., `release-1.9`), check whether the failing test was already fixed on `main` before proceeding with the healer:

```bash
git fetch upstream main
git log --oneline upstream/main -- <path-to-failing-spec-file> | head -10
```

If there are recent commits touching the failing spec file or its page objects, inspect them:

```bash
git log --oneline upstream/main -p -- <path-to-failing-spec-file> | head -100
```

If a fix exists on `main`, **always cherry-pick it** — this takes priority over running the healer:

```bash
git cherry-pick <commit-sha>
```

If the cherry-pick has conflicts, **resolve them manually** using the `main` commit as the source of truth and adapting to the release branch's code. Do not abandon the cherry-pick in favor of the healer — the fix on `main` is the authoritative solution.

After a successful cherry-pick (with or without conflict resolution), proceed to `e2e-verify-fix`. Only proceed to the healer below if **no relevant fix exists on `main`**.

## MANDATORY: Always Use the Playwright Healer Agent

**The Playwright healer agent MUST be used for ALL test failures, regardless of failure category.** Do not attempt manual diagnosis without first running the healer. The healer can run the test, debug it step-by-step, inspect the live UI, generate correct locators, and edit the code — often resolving the issue end-to-end without manual intervention.

> **Note**: The Playwright healer agent is currently supported in **OpenCode** and **Claude Code** only. In **Cursor** or other tools without Playwright agent support, skip the healer initialization and proceed directly to the "Failure Pattern Recognition" section below. Use manual diagnosis with direct test execution (`yarn playwright test ...`) and headed/debug mode (`--headed`, `--debug`) for live UI inspection.

### Healer Initialization

If not already initialized in this session, initialize the healer agent in `e2e-tests/`:

```bash
cd e2e-tests

# For OpenCode
npx playwright init-agents --loop=opencode

# For Claude Code
npx playwright init-agents --loop=claude
```

See https://playwright.dev/docs/test-agents for the full list of supported tools and options. The generated files are local tooling — do NOT commit them.

### Environment Setup for Healer

The healer agent needs a `.env` file in `e2e-tests/` with all required environment variables (BASE_URL, K8S_CLUSTER_TOKEN, vault secrets, etc.). Generate it by passing the `--env` flag to `local-test-setup.sh`:

```bash
cd e2e-tests
source local-test-setup.sh <showcase|rbac> --env
```

The `.env` file is gitignored — never commit it. To regenerate (e.g. after token expiry), re-run the command above.

### Invoking the Healer

Invoke the healer agent via the Task tool with `subagent_type: general`:

```
Task: "You are the Playwright Test Healer agent. Run the failing test, debug it, inspect the UI, and fix the code.
Working directory: <path>/e2e-tests
Test: <spec-file> --project=any-test -g '<test-name>'
Run command: set -a && source .env && set +a && npx playwright test <spec-file> --project=any-test --retries=0 --workers=1 -g '<test-name>'"
```

The healer will autonomously:
1. Run the test and identify the failure
2. Examine error screenshots and error-context.md
3. Debug the test step-by-step using Playwright Inspector
4. Inspect the live UI via page snapshots
5. Generate correct locators and fix assertions
6. Edit the test code
7. Re-run to verify the fix

### When to Supplement with Manual Diagnosis

After the healer has run, supplement with manual investigation only for:
- **Data dependency failures** (category 4): The healer may not know how to create missing test data
- **Platform-specific failures** (category 5): The healer doesn't have context about platform differences
- **Deployment configuration issues** (category 6): The healer cannot modify ConfigMaps or Helm values
- **Product bugs**: When the healer confirms the test is correct but the application behavior is wrong

## Failure Pattern Recognition

### 1. Locator Drift

**Symptoms**: `Error: locator.click: Error: strict mode violation` or `Timeout waiting for selector` or element not found errors.

**Cause**: The UI has changed and selectors no longer match.

**Fix approach**:
- Invoke the Playwright healer agent (`@playwright-test-healer`) — it will replay the test, inspect the current UI via page snapshots, generate updated locators, and edit the code automatically
- If the healer cannot resolve it, manually update to semantic role-based locators (see project rules)
- Verify the updated locator works by re-running the test

### 2. Timing / Race Condition

**Symptoms**: Test passes sometimes, fails sometimes. Errors like `Timeout 10000ms exceeded` or assertions failing on stale data.

**Cause**: Test acts before the UI is ready, or waits are insufficient.

**Fix approach**:
- Invoke the Playwright healer agent first — it can identify timing issues by stepping through the test and observing UI state transitions
- If manual fixes are needed: replace `page.waitForTimeout()` with proper waits: `expect(locator).toBeVisible()`, `page.waitForLoadState()`
- Use `expect().toPass()` with retry intervals for inherently async checks:
  ```typescript
  await expect(async () => {
    const text = await page.locator('.count').textContent();
    expect(Number(text)).toBeGreaterThan(0);
  }).toPass({ intervals: [1000, 2000, 5000], timeout: 30_000 });
  ```
- Increase action/navigation timeouts if the operation is legitimately slow
- Use `Common.waitForLoad()` utility before interacting with the page after navigation

### 3. Assertion Mismatch

**Symptoms**: `expect(received).toBe(expected)` with clearly different values.

**Cause**: The expected value has changed due to a product change, data change, or environment difference.

**Fix approach**:
- Determine if the change is intentional (check recent commits to the release branch)
- If intentional: update the expected value in the test or test data
- If unintentional: this may be a product bug — but you must first exhaust all other possibilities using the Playwright healer agent. Only after the healer confirms the test is correct and the application behavior is wrong should you mark it with `test.fixme()` (see the "Decision: Product Bug vs Test Issue" section below)

### 4. Data Dependency

**Symptoms**: Test fails because expected entities, users, or resources don't exist.

**Cause**: Test data assumptions no longer hold (GitHub repos deleted, Keycloak users changed, catalog entities removed).

**Fix approach**:
- Update test data in `e2e-tests/playwright/support/test-data/` or `e2e-tests/playwright/data/`
- Ensure test creates its own data in `beforeAll`/`beforeEach` and cleans up in `afterAll`/`afterEach`
- Use `APIHelper` for programmatic setup (GitHub API, Backstage catalog API)

### 5. Platform-Specific Failure

**Symptoms**: Test passes on OCP but fails on GKE/AKS/EKS, or vice versa.

**Cause**: Platform differences (Routes vs Ingress, different auth, different network policies).

**Fix approach**:
- Add conditional skip if the test is inherently platform-specific:
  ```typescript
  import { skipIfJobName, skipIfIsOpenShift } from '../utils/helper';
  // Skip on GKE
  skipIfJobName(constants.GKE_JOBS);
  // Skip on non-OpenShift
  skipIfIsOpenShift('false');
  ```
- Or add platform-specific logic within the test using `process.env.IS_OPENSHIFT`, `process.env.CONTAINER_PLATFORM`

### 6. Deployment Configuration Issue

**Symptoms**: RHDH itself is broken (500 errors, missing plugins, wrong behavior).

**Cause**: ConfigMap or Helm values are incorrect for this test scenario.

**Fix approach**:
- Check the ConfigMaps: `.ci/pipelines/resources/config_map/app-config-rhdh.yaml` and `app-config-rhdh-rbac.yaml`
- Check Helm values: `.ci/pipelines/value_files/`
- Check dynamic plugins config: `.ci/pipelines/resources/config_map/dynamic-plugins-config.yaml`
- Search `rhdh-operator` and `rhdh-chart` repos for configuration reference (use Sourcebot, Context7, `gh search code`, or a local clone — whichever is available)
- Fix the deployment configuration rather than the test code

## Playwright Test Agents Reference

The Playwright Test Agents are initialized via `npx playwright init-agents --loop=opencode` (see initialization section above). This creates an MCP server and agent definitions in `e2e-tests/opencode.json`.

### Healer Agent (MANDATORY for All Fixes)

The healer agent is the **primary and mandatory** tool for fixing failing tests. It has access to:

- **`test_run`**: Run tests and identify failures
- **`test_debug`**: Step through failing tests with the Playwright Inspector
- **`browser_snapshot`**: Capture accessibility snapshots of the live UI
- **`browser_console_messages`**: Read browser console logs
- **`browser_network_requests`**: Monitor network requests
- **`browser_generate_locator`**: Generate correct locators from the live UI
- **`edit`/`write`**: Edit test code directly

The healer autonomously cycles through: run → debug → inspect → fix → re-run until the test passes.

### Planner Agent (For Understanding Complex Scenarios)

Use `@playwright-test-planner` when you need to understand a complex user flow before fixing a test. It explores the app and maps out the interaction patterns.

### Generator Agent (For Creating New Test Steps)

Use `@playwright-test-generator` when a test needs major rework and you need to generate new test steps from a plan.

## Coding Conventions

Every fix **must** follow Playwright best practices. Before writing or modifying test code, consult these resources in order:

1. **Project rules** (always available locally):
   - `playwright-locators` rule — locator priority, anti-patterns, assertions, Page Objects, DataGrid handling
   - `ci-e2e-testing` rule — test structure, component annotations, project configuration, CI scripts

2. **Official Playwright docs** (fetch via Context7 if available, otherwise use web):
   - Best practices: https://playwright.dev/docs/best-practices
   - Locators guide: https://playwright.dev/docs/locators
   - Assertions: https://playwright.dev/docs/test-assertions
   - Auto-waiting: https://playwright.dev/docs/actionability

### Key requirements

- **Locators**: always prefer `getByRole()`, `getByLabel()`, `getByPlaceholder()` over CSS/XPath selectors. Never use MUI class names (`.MuiButton-label`, `.MuiDataGrid-*`).
- **Assertions**: use Playwright's auto-waiting assertions (`expect(locator).toBeVisible()`) — never use manual `waitForSelector()` or `waitForTimeout()`.
- **Component annotations**: every `*.spec.ts` file must have a `component` annotation in `test.beforeAll`.
- **Page Object Model**: return `Locator` objects from page classes, not raw strings or elements.
- **No `force: true`**: if a click requires `force`, the locator or timing is wrong — fix the root cause.
- **No `waitForNetworkIdle()`**: use proper load-state waits or assertion-based waiting instead.

## Cross-Repo Investigation

When the issue is in RHDH deployment/config rather than test code, search the relevant repos using whichever tool is available. Try them in this order and use the first one that works:

1. **Sourcebot** (if available): search repos for specific error patterns or configuration keys
2. **Context7** (if available): query repos for docs and code snippets
3. **Fallback — `gh search code`**: e.g. `gh search code '<pattern>' --repo redhat-developer/rhdh-operator`
4. **Fallback — local clone**: clone the repo into a temp directory and grep

### rhdh-operator (`redhat-developer/rhdh-operator`)
- Backstage CR specification and defaults
- CatalogSource configuration
- Operator installation scripts (especially `install-rhdh-catalog-source.sh`)

### rhdh-chart (`redhat-developer/rhdh-chart`)
- Helm values.yaml schema and defaults
- Chart templates for Deployments, Services, ConfigMaps
- Default dynamic plugin configurations

### Other Repositories
- **backstage/backstage**: For upstream Backstage API changes
- **redhat-developer/red-hat-developers-documentation-rhdh**: For documentation on expected behavior

## Decision: Product Bug vs Test Issue

**`test.fixme()` is a last resort.** You must be absolutely certain the failure is a product bug before marking a test this way. Follow this checklist:

1. **Run the Playwright healer agent** — it must confirm that the test logic is correct and the application behavior is wrong
2. **Verify manually** — inspect the live UI, check network responses, and confirm the product is genuinely broken (not a stale cache, missing data, or environment-specific issue)
3. **Check recent commits** — search the release branch for recent product changes that could explain the behavior change
4. **Ask the user for confirmation** before applying `test.fixme()` — do not decide unilaterally

Only after all of the above confirm a product bug:

1. **File a Jira bug** in the `RHDHBUGS` project (or update the existing ticket) documenting the product regression
2. **Mark the test with `test.fixme()`**, preceded by a `// TODO:` comment linking to the Jira ticket:
   ```typescript
   // TODO: https://redhat.atlassian.net/browse/RHDHBUGS-XXXX
   test.fixme('Button no longer visible after version upgrade');
   ```
3. **Do not change the test assertions** to match broken behavior
4. **Proceed to `e2e-submit-and-review`** with the `test.fixme()` change
