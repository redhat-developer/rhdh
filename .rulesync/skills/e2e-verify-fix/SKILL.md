---
name: e2e-verify-fix
description: >-
  Verify an E2E test fix by running the test multiple times and checking code
  quality
targets:
  - "*"
---

# Verify Fix

Verify that the test fix works reliably and passes all code quality checks.

## When to Use

Use this skill after implementing a fix (via `e2e-diagnose-and-fix`) to confirm the fix works before submitting a PR.

## MANDATORY: Use the Playwright Healer Agent for Verification

Always use the Playwright healer agent for test verification. The healer provides step-by-step debugging if a run fails, making it faster to iterate on fixes.

> **Note**: The Playwright healer agent is currently supported in **OpenCode** and **Claude Code** only. In **Cursor** or other tools without Playwright agent support, skip the healer initialization and use `local-test.sh` for all verification steps.

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

Export `BASE_URL` and an unlocked `BW_SESSION`. Set `K8S_CLUSTER_URL` and
`K8S_CLUSTER_TOKEN` for cluster-aware tests. Run local verification through `local-test.sh`; do
not generate a `.env` file containing secrets.

## Verification Steps

### 1. Single Run Verification via Healer

Invoke the healer agent to run the fixed test once:

```
Task: "You are the Playwright Test Healer agent. Verify a fix by running the test once.
Working directory: <path>/e2e-tests
Run: ./local-test.sh -- --project=any-test --retries=0 --workers=1 "$SPEC_FILE" -g "$TEST_NAME"
If it passes, report success. If it fails, examine the error and report what went wrong."
```

If it fails, go back to `e2e-diagnose-and-fix` and iterate — use the healer agent there too for the fix.

### 2. Multi-Run Stability Check

Run the test 5 times consecutively to verify no flakiness was introduced:

```bash
cd e2e-tests
PASS=0
FAIL=0
for i in $(seq 1 5); do
  echo "=== Stability run $i/5 ==="
  if ./local-test.sh -- --project=any-test --retries=0 --workers=1 "$SPEC_FILE" 2>&1; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
  fi
done
echo "Stability results: $PASS/5 passed"
```

**Acceptance criteria**: 5/5 passes. If any run fails, invoke the healer agent on the failing run to diagnose and fix the remaining issue — do not manually guess at fixes.

### 3. Full Project Stability Check

> **When to run**: This step is **required** if the failure was only reproducible when running the full CI project (`CI=true ./local-test.sh -- --project=<ci-project>`) during `e2e-reproduce-failure`. If the failure reproduced in isolated single-test runs, this step is optional but still recommended.

Run the full project to confirm the fix holds under CI-like concurrency:

```bash
cd e2e-tests
CI=true ./local-test.sh -- --project="$CI_PROJECT" --retries=0
```

Replace `<ci-project>` with the project from the CI failure (e.g., `showcase`, `showcase-rbac`). This verifies the fix under the same worker count and test interaction conditions that triggered the original failure.

**Acceptance criteria**: The full project run must pass. If the fixed test still fails when run alongside other tests, the fix is incomplete — return to `e2e-diagnose-and-fix`.

**IMPORTANT**: Never skip verification steps. If you cannot run tests (e.g., no cluster available, environment issues), **stop and ask the user for explicit approval** before proceeding without verification. Do not assume it's OK to skip.

### 4. Code Quality Checks

Run all code quality checks in the e2e-tests workspace:

```bash
cd e2e-tests

# ESLint
yarn lint

# Prettier formatting
yarn fmt:check
```

Fix any issues found:

```bash
# Auto-fix lint issues
yarn lint:fix

# Auto-fix formatting
yarn fmt
```

### 5. Optional: Full Project Regression Check

If the fix touches shared utilities or page objects, run the entire Playwright project to check for regressions:

```bash
cd e2e-tests
./local-test.sh -- --project="$PROJECT" --retries=0
```

This is optional for isolated spec file changes but recommended for changes to:

- `e2e-tests/playwright/utils/` (utility classes)
- `e2e-tests/playwright/support/` (page objects, selectors)
- `e2e-tests/playwright/data/` (shared test data)
- `playwright.config.ts` (configuration)

### 6. Review the Diff

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
