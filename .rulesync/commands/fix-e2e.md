---
targets:
  - '*'
description: >-
  Autonomously investigate and fix a failing RHDH E2E CI test. Accepts a Prow
  job URL or Jira ticket ID. Deploys RHDH, reproduces the failure, fixes the
  test using Playwright agents, and submits a PR with Qodo review.
---
# Fix E2E CI Failure

Autonomous workflow to investigate, reproduce, fix, and submit a PR for a failing RHDH E2E test.

## Input

`$ARGUMENTS` — A Prow job URL, Playwright report URL, Jira ticket ID, or Jira URL:
- **Prow URL**: `https://prow.ci.openshift.org/view/gs/...`
- **Playwright report URL**: `https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/.../index.html[#?testId=...]`
- **Jira ticket ID**: `RHIDP-XXXX`
- **Jira URL**: `https://redhat.atlassian.net/browse/RHIDP-XXXX`

## Workflow

Execute the following phases in order. Load each skill as needed for detailed instructions. If a phase fails, report the error and stop — do not proceed blindly.

### Phase 1: Parse CI Failure

**Skill**: `e2e-parse-ci-failure`

Parse the input to extract:
- Failing test name and spec file path
- Playwright project name
- Release branch (main, release-1.9, etc.)
- Platform (OCP, AKS, EKS, GKE)
- Deployment method (Helm, Operator)
- Error type and message
- local-run.sh job name parameter

**Decision gate**: If the input cannot be parsed (invalid URL, inaccessible Jira ticket), report the error and ask the user for clarification.

**Multiple failures**: If the job has more than one failing test:
1. Present all failures in a table with test name, spec file, error type, and consistency (e.g., "failed 3/3" vs "failed 1/3")
2. Group failures that likely share a root cause (same spec file, same error pattern, same page object)
3. **Ask the user** which failure(s) to focus on
4. If failures share a root cause, fix them together in one PR. If they're unrelated, fix them in separate branches/PRs — complete one before starting the next.

### Phase 2: Setup Fix Branch

First, check the current branch:

```bash
git branch --show-current
```

- **On `main` or `release-*`**: You're on a base branch — create a feature branch using the skill:
  ```bash
  git fetch upstream <release-branch>
  git checkout -b fix/e2e-<test-description> upstream/<release-branch>
  ```
  If a Jira ticket was provided, include the ticket ID in the branch name:
  `fix/RHIDP-XXXX-e2e-<test-description>`

- **On any other branch** (e.g., `fix/e2e-*`): You're likely already on a feature branch. **Ask the user** whether to:
  1. Use the current branch as-is
  2. Create a new branch from the upstream release branch

### Phase 3: Deploy RHDH

**Skill**: `e2e-deploy-rhdh`

Deploy RHDH to a cluster using `e2e-tests/local-run.sh`. CLI mode requires **all three** flags (`-j`, `-r`, `-t`):

**OCP jobs** — use `-s` (deploy-only) to skip automated test execution so you can run the specific failing test manually:
```bash
cd e2e-tests
./local-run.sh -j <full-prow-job-name> -r <image-repo> -t <image-tag> -s
```

**K8s jobs (AKS, EKS, GKE)** — do **not** use `-s`. These jobs require the full execution pipeline and do not support deploy-only mode:
```bash
cd e2e-tests
./local-run.sh -j <full-prow-job-name> -r <image-repo> -t <image-tag>
```

Use the **full Prow CI job name** for `-j` (not shortened names).

Select the image repo and tag based on the release branch:
- `main` → `-r rhdh-community/rhdh -t next`
- `release-1.9` → `-r rhdh/rhdh-hub-rhel9 -t 1.9`
- `release-1.8` → `-r rhdh/rhdh-hub-rhel9 -t 1.8`

After deployment completes, set up the local test environment:
```bash
source e2e-tests/local-test-setup.sh <showcase|rbac>
```

**Decision gate**: Before attempting deployment, verify cluster connectivity (`oc whoami`). If no cluster is available, **ask the user for explicit approval** before skipping this phase — do not skip silently. If deployment fails, the `e2e-deploy-rhdh` skill has error recovery procedures. If deployment cannot be recovered after investigation, report the deployment issue and stop.

### Phase 4: Reproduce Failure

**Skill**: `e2e-reproduce-failure`

Run the specific failing test to confirm it reproduces locally. Use `--project=any-test` to avoid running the smoke test dependency — it matches any spec file without extra overhead:

```bash
cd e2e-tests
yarn playwright test <spec-file> --project=any-test --retries=0 --workers=1
```

**Decision gates**:
- **No cluster or deployment available**: If Phase 3 was skipped or no running RHDH instance exists, **ask the user for explicit approval** before skipping reproduction — do not skip silently.
- **Consistent failure**: Proceed to Phase 5
- **Flaky** (fails sometimes): Proceed to Phase 5, focus on reliability
- **Cannot reproduce** (passes every time after 10 runs): Before giving up, try running the entire CI project with `CI=true yarn playwright test --project=<ci-project> --retries=0` to simulate CI conditions (3 workers, full test suite). If that also passes, report the results and **ask the user for explicit approval** before proceeding.

### Phase 5: Diagnose and Fix

**Skill**: `e2e-diagnose-and-fix`

Analyze the failure and implement a fix:

1. **Classify the failure**: locator drift, timing, assertion mismatch, data dependency, platform-specific, deployment config
2. **Use Playwright Test Agents**: Invoke the healer agent (`@playwright-test-healer`) for automated test repair — it can debug the test, inspect the UI, generate locators, and edit the code
3. **Follow Playwright best practices**: Consult the `playwright-locators` and `ci-e2e-testing` project rules. Use semantic role-based locators (`getByRole`, `getByLabel`), auto-waiting assertions, Page Object Model, component annotations. Fetch official Playwright best practices via Context7 or https://playwright.dev/docs/best-practices if needed
4. **Cross-repo investigation**: If the issue is in deployment config, search `rhdh-operator` and `rhdh-chart` repos. Use Sourcebot or Context7 if available; otherwise fall back to `gh search code` or clone the repo locally and grep

**Decision gate**: If the analysis reveals a product bug (not a test issue), you must be **absolutely certain** before marking a test with `test.fixme()`. The Playwright healer agent must have confirmed the test is correct and the application behavior is wrong. Ask the user for confirmation before proceeding. Then:
1. File or update a Jira bug in the `RHDHBUGS` project
2. Mark the test with `// TODO:` linking to the Jira ticket, followed by `test.fixme()`:
   ```typescript
   // TODO: https://redhat.atlassian.net/browse/RHDHBUGS-XXXX
   test.fixme('Description of the product bug');
   ```
3. Proceed to Phase 6 with the `test.fixme()` change

### Phase 6: Verify Fix

**Skill**: `e2e-verify-fix`

Verify the fix:
1. Run the fixed test once — must pass
2. Run 5 times — must pass 5/5
3. Run code quality checks: `yarn tsc:check`, `yarn lint:check`, `yarn prettier:check`
4. Fix any lint/formatting issues

**Decision gate**: If the test still fails or is flaky, return to Phase 5 and iterate. If verification cannot be run (no cluster, environment issues), **ask the user for explicit approval** before proceeding without it.

### Phase 7: Submit PR and Handle Review

**Skill**: `e2e-submit-and-review`

1. **Resolve pre-commit hooks**: Run `yarn install` in all relevant workspaces (root, `e2e-tests/`, `.ci/`) before committing
2. **Commit**: Stage changes, commit with conventional format
3. **Push**: `git push -u origin <branch>`
4. **Create draft PR**: Always use `--draft`. Determine the GitHub username from the fork remote: `git remote get-url origin | sed 's|.*github.com[:/]||;s|/.*||'`. Then use `gh pr create --draft --repo redhat-developer/rhdh --head <username>:<branch> --base <release-branch>`
5. **Trigger Qodo review**: Comment `/agentic_review` on the PR
6. **Wait for review**: Poll for Qodo bot review (check every 15s, up to 5 minutes)
7. **Address feedback**: Apply valid suggestions, explain rejections
8. **Trigger affected CI job**: After addressing review feedback, comment `/test ?` on the PR to list available presubmit jobs, then comment `/test <job-name>` to trigger the presubmit job matching the platform and deployment method from Phase 1
9. **Monitor CI**: Watch CI checks with `gh pr checks`

### Final Report

After all phases complete, produce a summary:

```
E2E Fix Summary:
- Input: <Prow URL or Jira ticket>
- Test: <spec file> (<playwright project>)
- Branch: <fix branch> → <release branch>
- Root cause: <classification and description>
- Fix: <what was changed>
- Verification: <X/X passes>
- PR: <PR URL>
- CI Status: <PASS/PENDING/FAIL>
- Qodo Review: <status>
```
