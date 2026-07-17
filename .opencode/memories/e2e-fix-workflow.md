# E2E Test Fix Workflow

Reference knowledge for the `/fix-e2e` command. For detailed instructions, load the corresponding skill for each phase.

## Workflow Overview

The `/fix-e2e` command orchestrates a 7-phase workflow to autonomously fix E2E CI failures:

1. **Parse CI Failure** (`e2e-parse-ci-failure`) — Extract failure details from Prow URL, Playwright report, or Jira ticket
2. **Setup Fix Branch** — Create a branch from the correct upstream release branch
3. **Deploy RHDH** (`e2e-deploy-rhdh`) — Deploy RHDH to a cluster using `local-run.sh`
4. **Reproduce Failure** (`e2e-reproduce-failure`) — Confirm the failure reproduces locally
5. **Diagnose and Fix** (`e2e-diagnose-and-fix`) — Analyze root cause and implement a fix
6. **Verify Fix** (`e2e-verify-fix`) — Run the test multiple times and check code quality
7. **Submit and Review** (`e2e-submit-and-review`) — Create PR, trigger review, monitor CI

**Critical rule**: No phase may be skipped without **explicit user approval**.

## Job Name Mapping Tables

These tables are the **single source of truth** — referenced by `e2e-parse-ci-failure` and other skills.

### Job Name → Release Branch

Extract the release branch from the Prow job name using the `-rhdh-<branch>-` pattern:

```bash
BRANCH=$(echo "$JOB_NAME" | grep -oE '\-rhdh-(main|release-[0-9]+\.[0-9]+)-' | sed 's/^-rhdh-//;s/-$//')
```

### Job Name → Platform and Deployment Method

| Pattern | Platform | Method |
|---------|----------|--------|
| `*ocp*helm*` | OCP | Helm |
| `*ocp*operator*` | OCP | Operator |
| `*aks*helm*` | AKS | Helm |
| `*aks*operator*` | AKS | Operator |
| `*eks*helm*` | EKS | Helm |
| `*eks*operator*` | EKS | Operator |
| `*gke*helm*` | GKE | Helm |
| `*gke*operator*` | GKE | Operator |
| `*osd-gcp*` | OSD-GCP | Helm/Operator |

### Job Name → Playwright Projects

| Job pattern | Projects |
|-------------|----------|
| `*ocp*helm*nightly*` (not upgrade, not localization) | `showcase`, `showcase-rbac`, `showcase-runtime`, `showcase-sanity-plugins` |
| `*ocp*helm*localization*nightly*` | `showcase-localization-de`, `showcase-localization-es`, `showcase-localization-fr`, `showcase-localization-it`, `showcase-localization-ja` |
| `*ocp*helm*upgrade*` | `showcase-upgrade` |
| `*ocp*operator*nightly*` (not auth) | `showcase-operator`, `showcase-operator-rbac` |
| `*ocp*operator*auth-providers*` | `showcase-auth-providers` |
| `*ocp*helm*pull*` | `showcase`, `showcase-rbac` |
| `*aks*`/`*eks*`/`*gke*` helm | `showcase-k8s`, `showcase-rbac-k8s` |
| `*aks*`/`*eks*`/`*gke*` operator | `showcase-k8s`, `showcase-rbac-k8s` |

### Job Name → local-run.sh `-j` Parameter

Use the **full Prow CI job name** directly as the `-j` parameter. Do NOT use shortened names.

**OCP** (deploy-only with `-s`): `./local-run.sh -j <full-job-name> -r <repo> -t <tag> -s`
**K8s** (full execution, no `-s`): `./local-run.sh -j <full-job-name> -r <repo> -t <tag>`

### Release Branch → Image Repo and Tag

```bash
if [[ "$BRANCH" == "main" ]]; then
  REPO="rhdh-community/rhdh"; TAG="next"
else
  REPO="rhdh/rhdh-hub-rhel9"; TAG="${BRANCH#release-}"
fi
```

## Coding Conventions

All test code must follow the project's coding rules:
- **`playwright-locators`** — locator priority, anti-patterns, assertions, Page Objects
- **`ci-e2e-testing`** — test structure, component annotations, utility classes, CI scripts
