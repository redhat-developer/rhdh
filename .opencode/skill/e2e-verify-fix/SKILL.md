---
name: e2e-verify-fix
description: >-
  Verify an E2E test fix by running the test multiple times and checking code
  quality
---
# Verify Fix

Verify that the test fix works reliably and passes all code quality checks.

## When to Use

Use this skill after implementing a fix (via `e2e-diagnose-and-fix`) to confirm the fix works before submitting a PR.

## MANDATORY: Use the Playwright Healer Agent for Verification

Always use the Playwright healer agent for test verification. The healer provides step-by-step debugging if a run fails, making it faster to iterate on fixes.

### Healer Initialization

If not already initialized in this session, use the `--loop` flag matching your AI coding tool:

```bash
cd e2e-tests

# For OpenCode
npx playwright init-agents --loop=opencode

# For Claude Code
npx playwright init-agents --loop=claude
```

See https://playwright.dev/docs/test-agents for the full list of supported tools and options.

Ensure the `.env` file exists — generate it with `source local-test-setup.sh <showcase|rbac> --env`. To regenerate (e.g. after token expiry), re-run the same command.

## Verification Steps

### 1. Single Run Verification via Healer

Invoke the healer agent to run the fixed test once:

```
Task: "You are the Playwright Test Healer agent. Verify a fix by running the test once.
Working directory: <path>/e2e-tests
Run: set -a && source .env && set +a && npx playwright test <spec-file> --project=any-test --retries=0 --workers=1 -g '<test-name>'
If it passes, report success. If it fails, examine the error and report what went wrong."
```

If it fails, go back to `e2e-diagnose-and-fix` and iterate — use the healer agent there too for the fix.

### 2. Multi-Run Stability Check

Run the test 5 times consecutively to verify no flakiness was introduced:

```bash
cd e2e-tests
set -a && source .env && set +a
PASS=0; FAIL=0
for i in $(seq 1 5); do
  echo "=== Stability run $i/5 ==="
  if npx playwright test <spec-file> --project=any-test --retries=0 --workers=1 2>&1; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
  fi
done
echo "Stability results: $PASS/5 passed"
```

**Acceptance criteria**: 5/5 passes. If any run fails, invoke the healer agent on the failing run to diagnose and fix the remaining issue — do not manually guess at fixes.

**IMPORTANT**: Never skip verification steps. If you cannot run tests (e.g., no cluster available, environment issues), **stop and ask the user for explicit approval** before proceeding without verification. Do not assume it's OK to skip.

### 3. Code Quality Checks

Run all code quality checks in the e2e-tests workspace:

```bash
cd e2e-tests

# TypeScript compilation
yarn tsc:check

# ESLint
yarn lint:check

# Prettier formatting
yarn prettier:check
```

Fix any issues found:

```bash
# Auto-fix lint issues
yarn lint:fix

# Auto-fix formatting
yarn prettier:fix
```

### 4. Optional: Full Project Regression Check

If the fix touches shared utilities or page objects, run the entire Playwright project to check for regressions:

```bash
cd e2e-tests
yarn playwright test --project=<project> --retries=0
```

This is optional for isolated spec file changes but recommended for changes to:
- `e2e-tests/playwright/utils/` (utility classes)
- `e2e-tests/playwright/support/` (page objects, selectors)
- `e2e-tests/playwright/data/` (shared test data)
- `playwright.config.ts` (configuration)

### 5. Review the Diff

Before submitting, review all changes:

```bash
git diff
git diff --stat
```

Verify:
- Only intended files were changed
- No secrets or credentials were added
- No unrelated changes were included
- Component annotations are present in any new/modified spec files
- Semantic selectors are used (no deprecated CSS class selectors)

## Result Summary

After verification, produce a summary:

```
Fix Verification Results:
- Test: <spec-file> (<project>)
- Single run: PASS
- Stability (5 runs): 5/5 PASS
- TypeScript: PASS
- ESLint: PASS
- Prettier: PASS
- Files changed: <list>
- Ready for PR: YES/NO
```
