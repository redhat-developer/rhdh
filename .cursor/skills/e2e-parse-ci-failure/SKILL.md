---
name: e2e-parse-ci-failure
description: Parse a Prow CI job URL or Jira ticket to extract E2E test failure details including test name, spec file, release branch, platform, and error messages
---
# Parse CI Failure

Extract structured failure context from a Prow job URL or Jira ticket for an RHDH E2E CI failure.

## When to Use

Use this skill when you receive a failing Prow job URL (e.g., `https://prow.ci.openshift.org/view/gs/...`), a Jira ticket ID (e.g., `RHIDP-XXXX`), or a Jira URL (e.g., `https://redhat.atlassian.net/browse/RHIDP-XXXX`) for an E2E test failure and need to extract all relevant details before starting a fix.

## Input Detection

- **Playwright report URL**: URL ending in `index.html` (with optional `#?testId=...` fragment) — use Playwright MCP if available (see "Playwright Report Parsing" below), otherwise fall back to build log parsing
- **Prow URL**: Starts with `https://prow.ci.openshift.org/` — parse the job page and build log
- **Jira ticket ID**: Matches pattern `RHIDP-\d+` or similar — use Jira MCP tools to read the ticket
- **Jira URL**: Starts with `https://redhat.atlassian.net/browse/` — extract the ticket ID from the URL path (e.g., `RHIDP-XXXX` from `https://redhat.atlassian.net/browse/RHIDP-XXXX`) and then use Jira MCP tools to read the ticket

## Prow URL Parsing

### URL Structure

Prow job URLs follow two patterns:

- **Periodic/postsubmit**: `https://prow.ci.openshift.org/view/gs/test-platform-results/logs/<job-name>/<build-id>`
- **Presubmit (PR)**: `https://prow.ci.openshift.org/view/gs/test-platform-results/pr-logs/pull/redhat-developer_rhdh/<pr-number>/<job-name>/<build-id>`

Extract `<job-name>` and `<build-id>` from the URL path. These are the two key values needed for all derivations.

### GCS URL Derivation

Convert the Prow URL to a GCS artifacts URL by replacing the prefix:

```
Prow:  https://prow.ci.openshift.org/view/gs/test-platform-results/logs/<job-name>/<build-id>
GCS:   https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results/logs/<job-name>/<build-id>/artifacts/
```

For presubmit jobs, use `pr-logs/pull/redhat-developer_rhdh/<pr-number>/` instead of `logs/`.

Key artifacts within the GCS directory:
- **Build log**: `<step-name>/build-log.txt`
- **JUnit XML**: `<step-name>/artifacts/junit-results/results.xml`
- **Playwright report**: `<step-name>/artifacts/playwright-report/`

Fetch the Prow job page with WebFetch to find the job status and artifact links, then fetch the build log for test failure details.

### Extracting Test Failures from Build Log

Search the build log for these Playwright output patterns:

```
# Failing test line (primary source for test name, spec file, and project):
  ✘  [<project>] › <path>/<spec-file>.spec.ts:<line> › <test-describe> › <test-name>

# Error details (immediately after the failure line):
  Error: <error-message>
  expect(received).toBeVisible()
  Locator: <locator>

# Summary (at the end of the log):
  X failed
  X passed
  X skipped
```

Also check JUnit XML for `<testcase>` elements with `<failure>` children as a fallback.

## Playwright Report Parsing

When the URL points to a Playwright HTML report (`index.html`, optionally with `#?testId=...`), use Playwright MCP if available — navigate with `browser_navigate`, then `browser_snapshot` to extract test name, spec file, error, steps, retries, screenshots, and traces from the accessibility tree. Derive job metadata (`<job-name>`, `<build-id>`, `<project>`) from the URL path segments.

If Playwright MCP is not available, derive the `build-log.txt` URL from the report URL and fall back to build log parsing.

## Jira Ticket Parsing

Use Jira MCP tools to read the ticket. Extract:

1. **Prow job URLs** from the description or comments — then parse them using the Prow URL Parsing steps above.
2. **Test names, spec file paths, error messages, or stack traces** from the description, comments, or attachments.
3. **`affects version`** field — map to release branch (e.g., `1.10` → `main`, `1.9` → `release-1.9`, `1.8` → `release-1.8`).
4. **`component`** field for additional context (e.g., "E2E Tests", "CI/CD").

## Job Name Mapping

Refer to the **e2e-fix-workflow** rule for all mapping tables: job name to release branch, job name to platform and deployment method, job name to Playwright projects, release branch to image repo/tag, and job name to `local-run.sh` `-j` parameter. Those tables are the single source of truth and should not be duplicated here.

When parsing a job name, apply those mapping tables to derive: release branch, platform, deployment method, Playwright projects, and `local-run.sh` flags (`-j`, `-r`, `-t`).

## Fields Requiring Build Log Access

Not all output fields can be derived from the Prow URL alone. The following table clarifies what requires fetching the build log or artifacts:

| Field | Source | Derivable from URL alone? |
|-------|--------|---------------------------|
| Job name | URL path segment | Yes |
| Build ID | URL path segment | Yes |
| Release branch | Job name pattern match | Yes |
| Platform | Job name pattern match | Yes |
| Deployment method | Job name pattern match | Yes |
| Playwright projects | Job name pattern match | Yes |
| `local-run.sh` flags (`-j`, `-r`, `-t`) | Job name + release branch | Yes |
| GCS artifacts URL | Constructed from URL | Yes |
| Test name | Build log Playwright output | No — requires build log |
| Spec file | Build log Playwright output | No — requires build log |
| Specific Playwright project (of failing test) | Build log `[project]` prefix | No — requires build log |
| Error type | Build log error details | No — requires build log |
| Error message | Build log error details | No — requires build log |
| Failure count / pass count | Build log summary line | No — requires build log |

## Output

Produce the following structured output with three sections.

### 1. Structured Summary

```
- Test name: <full test name from Playwright output>
- Spec file: <path relative to e2e-tests/playwright/>
- Playwright project: <specific project from the [project] prefix in the failure line>
- Release branch: <main or release-X.Y>
- Platform: <OCP/AKS/EKS/GKE/OSD-GCP>
- Deployment method: <Helm/Operator>
- Error type: <locator/timeout/assertion/crash/deployment>
- Error message: <the actual error>
- Prow URL: <original URL>
- Jira ticket: <ticket ID if applicable>
```

### 2. Derivation Details

Show how each field was derived with the matching pattern. This makes the reasoning transparent and auditable.

```
| Field              | Value                        | Derivation                                                |
|--------------------|------------------------------|-----------------------------------------------------------|
| Job name           | <full-job-name>              | Extracted from URL path segment                           |
| Build ID           | <build-id>                   | Extracted from URL path segment                           |
| Release branch     | <branch>                     | Pattern `*-rhdh-<branch>-*` matched in job name           |
| Platform           | <platform>                   | Pattern `*<platform-keyword>*` matched in job name        |
| Deployment method  | <method>                     | Pattern `*<method-keyword>*` matched in job name          |
| Playwright project | <project>                    | `[<project>]` prefix in failing test line                 |
| Image repo (-r)    | <repo>                       | Release branch `<branch>` maps to `<repo>`                |
| Image tag (-t)     | <tag>                        | Release branch `<branch>` maps to `<tag>`                 |
| Test name          | <test-name>                  | Parsed from `✘` line in build log                         |
| Spec file          | <spec-file>                  | Parsed from `✘` line in build log                         |
| Error type         | <error-type>                 | Classified from error message pattern                     |
```

### 3. GCS Artifacts Location

Derive and present the GCS artifacts URLs constructed from the Prow URL:

```
GCS Artifacts Base:
  https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results/logs/<job-name>/<build-id>/artifacts/

Build Log:
  <base>/artifacts/<step-name>/build-log.txt

JUnit Results:
  <base>/artifacts/<step-name>/artifacts/junit-results/results.xml

Playwright Report:
  <base>/artifacts/<step-name>/artifacts/playwright-report/
```

For presubmit (PR) jobs, the base path uses `pr-logs/pull/redhat-developer_rhdh/<pr-number>/` instead of `logs/`.

### 4. local-run.sh Command

Provide the full command ready to copy-paste, with a flag breakdown.

**OCP jobs** — use `-s` for deploy-only mode:
```
cd e2e-tests
./local-run.sh -j <full-job-name> -r <image-repo> -t <image-tag> -s

Flag breakdown:
| Flag | Value              | Reason                                           |
|------|--------------------|--------------------------------------------------|
| -j   | <full-job-name>    | Full Prow job name (matches glob in CI script)   |
| -r   | <image-repo>       | Image repo derived from release branch <branch>  |
| -t   | <image-tag>        | Image tag derived from release branch <branch>   |
| -s   | (no value)         | Deploy only, skip running tests                  |
```

**K8s jobs (AKS, EKS, GKE)** — do **not** use `-s`; full execution is required:
```
cd e2e-tests
./local-run.sh -j <full-job-name> -r <image-repo> -t <image-tag>

Flag breakdown:
| Flag | Value              | Reason                                           |
|------|--------------------|--------------------------------------------------|
| -j   | <full-job-name>    | Full Prow job name (matches glob in CI script)   |
| -r   | <image-repo>       | Image repo derived from release branch <branch>  |
| -t   | <image-tag>        | Image tag derived from release branch <branch>   |
```
