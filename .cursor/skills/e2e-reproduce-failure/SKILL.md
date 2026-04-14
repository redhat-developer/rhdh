---
name: e2e-reproduce-failure
description: Run a specific failing E2E test against a deployed RHDH instance to confirm the failure and determine if it is consistent or flaky
---
# Reproduce Failure

Run the failing test locally against a deployed RHDH instance to confirm the failure and classify it.

## When to Use

Use this skill after deploying RHDH (via `e2e-deploy-rhdh`) when you need to verify the test failure reproduces locally before attempting a fix.

## Prerequisites

- RHDH deployed and accessible (BASE_URL set)
- Environment configured via `source e2e-tests/local-test-setup.sh <showcase|rbac>`
- Node.js 22 and Yarn available
- Playwright browsers installed (`cd e2e-tests && yarn install && yarn playwright install chromium`)

## Environment Setup

### Source the Test Environment

```bash
# For non-RBAC tests (showcase, showcase-k8s, showcase-operator, etc.)
source e2e-tests/local-test-setup.sh showcase

# For RBAC tests (showcase-rbac, showcase-rbac-k8s, showcase-operator-rbac)
source e2e-tests/local-test-setup.sh rbac
```

This exports all required environment variables: `BASE_URL`, `K8S_CLUSTER_URL`, `K8S_CLUSTER_TOKEN`, and all Vault secrets.

### Verify Environment

```bash
echo "BASE_URL: $BASE_URL"
curl -sSk "$BASE_URL" -o /dev/null -w "HTTP Status: %{http_code}\n"
```

## MANDATORY: Use the Playwright Healer Agent for Reproduction

Always use the Playwright healer agent to run and reproduce failing tests. The healer provides richer diagnostics than plain `yarn playwright test` — it can debug step-by-step, inspect the live UI, and collect detailed failure context automatically.

### Healer Initialization (First Time Only)

Before first use in a session, initialize the healer agent with the `--loop` flag matching your AI coding tool:

```bash
cd e2e-tests

# For OpenCode
npx playwright init-agents --loop=opencode

# For Claude Code
npx playwright init-agents --loop=claude
```

See https://playwright.dev/docs/test-agents for the full list of supported tools and options.

### Environment Setup

Generate the `.env` file by passing the `--env` flag to `local-test-setup.sh`:

```bash
cd e2e-tests
source local-test-setup.sh <showcase|rbac> --env
```

To regenerate (e.g. after token expiry), re-run the command above.

### Project Selection

When running specific test files or test cases, use `--project=any-test` to avoid running the smoke test dependency. The `any-test` project matches any spec file without extra overhead:

```bash
yarn playwright test <spec-file> --project=any-test --retries=0 --workers=1
```

### Running via Healer Agent

Invoke the healer agent via the Task tool:

```
Task: "You are the Playwright Test Healer agent. Run the following test to reproduce a CI failure.
Working directory: <path>/e2e-tests
Test: <spec-file> --project=any-test -g '<test-name>'
Run: set -a && source .env && set +a && npx playwright test <spec-file> --project=any-test --retries=0 --workers=1 -g '<test-name>'
If the test fails, examine the error output, screenshots in test-results/, and error-context.md.
Report: pass/fail, exact error message, what the UI shows at the point of failure."
```

### Fallback: Direct Execution

If the healer agent is unavailable, run tests directly:

```bash
cd e2e-tests
yarn playwright test <spec-file> --project=any-test --retries=0 --workers=1
```

**Examples:**
```bash
# A specific spec file
yarn playwright test playwright/e2e/plugins/topology/topology.spec.ts --project=any-test --retries=0 --workers=1

# A specific test by name
yarn playwright test -g "should display topology" --project=any-test --retries=0 --workers=1
```

### Headed / Debug Mode

For visual debugging when manual investigation is needed:

```bash
# Headed mode (visible browser)
yarn playwright test <spec-file> --project=any-test --retries=0 --workers=1 --headed

# Debug mode (Playwright Inspector, step-by-step)
yarn playwright test <spec-file> --project=any-test --retries=0 --workers=1 --debug
```

## Flakiness Detection

If the first run **passes** (doesn't reproduce the failure), run multiple times to check for flakiness:

```bash
cd e2e-tests

# Run 10 times and track results
PASS=0; FAIL=0
for i in $(seq 1 10); do
  echo "=== Run $i ==="
  if yarn playwright test <spec-file> --project=any-test --retries=0 --workers=1 2>&1; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
  fi
done
echo "Results: $PASS passed, $FAIL failed out of 10 runs"
```

## Result Classification

### Consistent Failure
- **Definition**: Fails every time (10/10 runs fail)
- **Action**: Proceed to `e2e-diagnose-and-fix` skill
- **Confidence**: High — the fix can be verified reliably

### Flaky
- **Definition**: Fails some runs but not all (e.g., 3/10 fail)
- **Action**: Proceed to `e2e-diagnose-and-fix` skill, focus on reliability improvements
- **Typical causes**: Race conditions, timing dependencies, state leaks between tests, external service variability

### Cannot Reproduce
- **Definition**: Passes all runs locally (0/10 fail)
- **Action**: **Stop and ask the user for approval before skipping this step.** Present the reproduction results and the list of possible environment differences. Do not proceed to diagnose-and-fix without explicit user confirmation.
- **Investigation**: Check environment differences between local and CI:
  - **Cluster version**: CI may use a different OCP version (check the cluster pool version)
  - **Image version**: CI may use a different RHDH image
  - **Resource constraints**: CI clusters may have less resources
  - **Parallel execution**: CI runs with 3 workers; try `--workers=3`
  - **Network**: CI clusters are in `us-east-2` AWS region
  - **External services**: GitHub API rate limits, Keycloak availability

## Artifact Collection

### Playwright Traces

After a test failure, traces are saved in `e2e-tests/test-results/`:

```bash
# View a trace
yarn playwright show-trace test-results/<test-path>/trace.zip
```

### HTML Report

```bash
# Generate and open the HTML report
yarn playwright show-report
```

### Screenshots and Videos

On failure, screenshots and videos are saved in `test-results/<test-path>/`:
- `test-failed-1.png` — Screenshot at failure point
- `video.webm` — Full test recording (if video is enabled)

## Test Project Reference

Refer to the e2e-fix-workflow rule for the Playwright project → config map mapping.
