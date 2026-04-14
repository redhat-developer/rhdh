---
name: e2e-submit-and-review
description: >-
  Create a PR for an E2E test fix, trigger Qodo agentic review, address review
  comments, and monitor CI results
targets:
  - '*'
---
# Submit and Review

Create a pull request for the E2E test fix, trigger automated review, address feedback, and verify CI passes.

## When to Use

Use this skill after verifying the fix (via `e2e-verify-fix`) when all tests pass and code quality checks are clean.

## Step 0: Resolve Pre-Commit Hooks

Before committing, ensure all related workspaces have their dependencies installed so pre-commit hooks (lint-staged, rulesync, etc.) pass:

```bash
# Root workspace
yarn install

# If e2e-tests files were changed
cd e2e-tests && yarn install && cd ..

# If .ci files were changed
cd .ci && yarn install && cd ..
```

If a pre-commit hook fails during commit, fix the issue and create a **new** commit — do not amend.

## Step 1: Commit Changes

### Stage and Commit

```bash
# Stage only relevant files
git add e2e-tests/
git add .ci/  # Only if deployment config was changed

# Commit with a descriptive message
git commit -m "fix(e2e): <short description of what was fixed>

<Longer description if needed explaining:>
- What test was failing
- What the root cause was
- How it was fixed"
```

### Commit Message Convention

Follow the conventional commit format:
- `fix(e2e): fix flaky topology test timeout`
- `fix(e2e): update RBAC page locators after UI redesign`
- `fix(e2e): add retry logic for catalog entity refresh`
- `fix(e2e): skip orchestrator test on GKE platform`

If a Jira ticket exists, reference it:
- `fix(e2e): fix topology locator drift [RHIDP-1234]`

## Step 2: Push to Fork

Push the fix branch to the fork (origin):

```bash
git push -u origin <branch-name>
```

Example:
```bash
git push -u origin fix/e2e-topology-locator
# or
git push -u origin fix/RHIDP-1234-e2e-topology-locator
```

## Step 3: Create Pull Request

Create a PR against the upstream `redhat-developer/rhdh` repository.

**Dynamic username extraction** -- Always derive the GitHub username from the fork remote at runtime rather than hardcoding it. This makes the workflow portable across any contributor's environment:

```bash
GITHUB_USER=$(git remote get-url origin | sed 's|.*github.com[:/]||;s|/.*||')
```

Then create the PR as a **draft** (always use `--draft`):
```bash
gh pr create \
  --draft \
  --repo redhat-developer/rhdh \
  --head "${GITHUB_USER}:<branch-name>" \
  --base <release-branch> \
  --title "fix(e2e): <description>" \
  --body "$(cat <<'EOF'
## Summary
- <1-2 bullet points explaining what was fixed and why>

## Test Results
- Local verification: 5/5 passes
- Code quality: lint, tsc, prettier all pass

## Related
- Prow job: <URL if applicable>
- Jira: <ticket ID if applicable>
EOF
)"
```

**Important**: Always use `--repo redhat-developer/rhdh` and `--head <username>:<branch>` for cross-fork PRs. Never hardcode the GitHub username -- always extract it dynamically from the origin remote URL so this workflow works for any contributor.

### PR Description Guidelines

Keep it concise:
- What test was failing
- What the root cause was
- How it was fixed
- Link to the original failing CI job or Jira ticket

## Step 4: Trigger Qodo Agentic Review

After the PR is created, trigger an agentic review from Qodo (PR-Agent):

```bash
# Get the PR number from the create output, then comment
gh pr comment <PR-number> --repo redhat-developer/rhdh --body "/agentic_review"
```

The Qodo bot will:
1. Analyze the code changes
2. Post review comments with suggestions
3. Optionally approve or request changes

Note: The `.pr_agent.toml` in the repo configures Qodo with:
- RAG enabled across `rhdh`, `rhdh-operator`, `rhdh-chart`, and documentation repos
- Auto-review, auto-describe, and auto-improve on PR creation
- Scoped to `e2e-tests` folder changes

## Step 5: Wait for and Address Qodo Review

### Poll for Review Comments

Check for Qodo review completion (it typically takes 1-3 minutes):

```bash
# Check for Qodo bot comments
gh api repos/redhat-developer/rhdh/pulls/<PR-number>/reviews \
  --jq '.[] | select(.user.login | test("github-actions|qodo|codium|pr-agent")) | .state'

# Check for inline comments
gh api repos/redhat-developer/rhdh/pulls/<PR-number>/comments \
  --jq '.[] | select(.user.login | test("github-actions|qodo|codium|pr-agent")) | {path: .path, line: .line, body: .body}'
```

### Address Review Comments

For each review comment:

1. **Code suggestions**: If the suggestion improves the code, apply it:
  ```bash
  # Make the change locally
  # Then stage only the changed files and commit
  git add <specific-files>
  git commit -m "fix(e2e): address review feedback"
  git push
  ```
   **Never use `git add -A` or `git add .`** — always stage specific files to avoid committing `.env`, test artifacts, or other local-only files.

2. **Style/convention issues**: Fix them per project conventions

3. **False positives**: If a suggestion is incorrect, explain why in a reply:
  ```bash
  gh api repos/redhat-developer/rhdh/pulls/<PR-number>/comments/<comment-id>/replies \
    -f body="This is intentional because <reason>"
  ```

4. **Questions**: Answer them with context from the codebase

## Step 6: Trigger Affected CI Job

After addressing Qodo review feedback (and pushing any follow-up commits), trigger the presubmit E2E job that corresponds to the originally failing CI job. Presubmit job names differ from periodic/nightly names but cover the same platform and deployment method.

**CRITICAL**: Never guess or construct presubmit job names. Always discover them from the `openshift-ci` bot response as described below.

### Step 6a: Request Available Jobs

Comment `/test ?` on the PR to request the list of available presubmit jobs:

```bash
gh pr comment <PR-number> --repo redhat-developer/rhdh --body "/test ?"
```

### Step 6b: Wait for the Bot Response

Poll PR comments every 30 seconds (up to 5 minutes) for a response from the `openshift-ci` bot containing the available job list:

```bash
# Poll for the openshift-ci bot response (check every 30s, up to 10 attempts = 5 min)
for i in $(seq 1 10); do
  BOT_RESPONSE=$(gh api repos/redhat-developer/rhdh/issues/<PR-number>/comments \
    --jq '[.[] | select(.user.login == "openshift-ci[bot]" or .user.login == "openshift-ci-robot")] | last | .body // empty')
  if [[ -n "$BOT_RESPONSE" ]] && echo "$BOT_RESPONSE" | grep -q '/test'; then
    echo "Bot response received:"
    echo "$BOT_RESPONSE"
    break
  fi
  echo "Waiting for openshift-ci bot response (attempt $i/10)..."
  sleep 30
done
```

If no response is received after 5 minutes, ask the user for guidance.

### Step 6c: Select the Right Job from the Bot Response

Parse the bot's response to find the presubmit job name matching the platform and deployment method from Phase 1. Use these patterns to identify the right job:

| Original failure pattern | Look for presubmit containing |
|--------------------------|-------------------------------|
| `*ocp*helm*nightly*` | `*ocp*helm*` (not nightly) |
| `*ocp*operator*nightly*` | `*ocp*operator*` |
| `*aks*helm*` | `*aks*helm*` |
| `*eks*helm*` | `*eks*helm*` |
| `*gke*helm*` | `*gke*helm*` |

**Example**: If the original failure was `periodic-ci-redhat-developer-rhdh-main-e2e-ocp-v4-20-helm-nightly`, look for a presubmit job in the bot's response like `pull-ci-redhat-developer-rhdh-main-e2e-ocp-v4-17-helm`.

If no matching job appears in the bot's response, pick the closest available job for the same platform and deployment method **from the list the bot returned**. If no suitable job exists in the list, inform the user and ask how to proceed.

### Step 6d: Trigger the Job

Comment `/test <job-name>` using **only** a job name that appeared in the bot's response from Step 6b:

```bash
gh pr comment <PR-number> --repo redhat-developer/rhdh --body "/test <presubmit-job-name>"
```

**Never** construct, guess, or infer job names from the original periodic/nightly job name. Only use exact job names from the `openshift-ci` bot's `/test ?` response.

## Step 7: Monitor CI Status

### Watch CI Checks

After pushing changes, monitor the CI pipeline:

```bash
gh pr checks <PR-number> --repo redhat-developer/rhdh --watch
```

Or check manually:
```bash
gh pr checks <PR-number> --repo redhat-developer/rhdh
```

CI check types (Prow E2E jobs, lint checks, build checks, etc.) are documented in the project CI rules. Use `gh pr checks` output to identify which specific check failed.

### If CI Fails

1. **E2E test failure**: Check the Prow job logs, determine if it's the same test or a different one
2. **Lint failure**: Run `yarn lint:fix` locally, commit and push
3. **Build failure**: Check TypeScript errors with `yarn tsc`
4. **Unrelated failure**: Comment on the PR noting it's an unrelated failure, optionally `/retest` to re-trigger

### Re-trigger CI

If a CI check needs to be re-run:
```bash
# For Prow jobs, comment on the PR
gh pr comment <PR-number> --repo redhat-developer/rhdh --body "/retest"

# For specific jobs
gh pr comment <PR-number> --repo redhat-developer/rhdh --body "/retest <job-name>"
```

## Step 8: Final Status Report

After CI passes (or all issues are addressed), produce a final report:

```
PR Status Report:
- PR: <URL>
- Branch: <branch> -> <release-branch>
- CI Status: PASS / PENDING / FAIL
- Qodo Review: Addressed / Pending
- Files changed: <count>
- Action items: <any remaining items>
```

## Quick Reference: PR Workflow Commands

```bash
# Determine GitHub username from fork remote
GITHUB_USER=$(git remote get-url origin | sed 's|.*github.com[:/]||;s|/.*||')

# Create draft PR (always use --draft)
gh pr create --draft --repo redhat-developer/rhdh --head "${GITHUB_USER}:<branch>" --base <release-branch>

# Trigger Qodo review
gh pr comment <PR#> --repo redhat-developer/rhdh --body "/agentic_review"

# List available presubmit jobs (Step 6a)
gh pr comment <PR#> --repo redhat-developer/rhdh --body "/test ?"

# Wait for openshift-ci bot response (Step 6b) -- poll until bot replies with job list

# Trigger specific presubmit job (Step 6d) -- ONLY use a job name from the bot's response
gh pr comment <PR#> --repo redhat-developer/rhdh --body "/test <job-name-from-bot-response>"

# Check CI status
gh pr checks <PR#> --repo redhat-developer/rhdh

# Re-trigger tests
gh pr comment <PR#> --repo redhat-developer/rhdh --body "/retest"

# View PR
gh pr view <PR#> --repo redhat-developer/rhdh --web
```
