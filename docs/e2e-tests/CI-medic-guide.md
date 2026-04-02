# CI Medic Guide

A practical guide for investigating test failures in RHDH Core (`redhat-developer/rhdh`) nightly jobs and PR checks.

## Table of Contents

- [Overview](#overview)
- [How to Use This Guide](#how-to-use-this-guide)
- [Anatomy of a Prow Job](#anatomy-of-a-prow-job)
- [Where to Find Logs and Artifacts](#where-to-find-logs-and-artifacts)
- [Job Lifecycle and Failure Points](#job-lifecycle-and-failure-points)
- [Job Types Reference](#job-types-reference)
- [Identifying Failure Types](#identifying-failure-types)
- [Finding Past Failures](#finding-past-failures)
- [Useful Links and Tools](#useful-links-and-tools)
- [AI Test Triager](#ai-test-triager-nightly-test-alerts)

---

## Overview

### What is a CI Medic?

The CI medic is a **weekly rotating role** responsible for maintaining the health of PR checks and nightly E2E test jobs. When your rotation starts, you'll receive a Slack message with your responsibilities as a reminder. The complete role description is described in [this Google Doc](https://docs.google.com/document/d/1CjqSQYA6g35-95OpHXobcJdWFRGS5yu-MV8-mfuDmQA/edit?usp=sharing)

### Core Responsibilities

1. **Monitor PR Checks**: Keep an eye on the status and the queue to ensure they remain passing.
2. **Monitor Nightly Jobs**: Watch the `#rhdh-e2e-alerts` Slack channel and dedicated release channels.
3. **Triage Failures**:
   - Use the **AI Test Triager** (`@Nightly Test Alerts` Slack app) as your starting point -- it automatically analyzes failed nightly jobs and provides root cause analysis, screenshot interpretation, and links to similar Jira issues. You can also invoke it manually by tagging `@Nightly Test Alerts` in Slack.
   - Check [Jira](https://redhat.atlassian.net/jira/dashboards/21388#v=1&d=21388&rf=acef7fac-ada0-4363-b3fb-9aad7ae021f0&static=f0579c09-f63e-45aa-87b9-05e042eee707&g=60993:view@0a7ec296-c2fd-4ddc-b7cb-64de0540e8ba) for existing issues with the **`ci-fail`** label.
   - If it's a **new issue**, create a bug and assign it to the responsible team or person. The AI triager can also create Jira bugs directly.
   - If the failure **blocks PRs**, mark the test as skipped (`test.fixme`) until it is fixed.
4. **Monitor Infrastructure**: Watch `#announce-testplatform` for general OpenShift CI outages and issues. Get help at `#forum-ocp-testplatform`.
5. **Quality Cabal Call**: Attend the call and provide a status update of the CI.

### Where Do Alerts Come In?

- **Main branch**: `#rhdh-e2e-alerts` Slack channel
- **Release branches**: Dedicated channels like `#rhdh-e2e-alerts-1-8`, `#rhdh-e2e-alerts-1-9`, etc.
- **Infrastructure announcements**: `#announce-testplatform` (general OpenShift CI status)
- **Getting help**: `#forum-ocp-testplatform` (ask questions about CI platform issues, or see if others face similar issues)

Each alert includes links to the job logs, artifacts, and a summary of which deployments/tests passed or failed. Check the bookmarks/folders in the `#rhdh-e2e-alerts` channel for additional resources.

### Two Types of CI Jobs

| | Nightly (Periodic) Jobs | PR Check (Presubmit) Jobs |
|---|---|---|
| **Trigger** | Scheduled (usually once per night) | On PR creation/update, or `/ok-to-test` |
| **Scope** | Full suite: showcase, RBAC, runtime, sanity plugins, localization, auth providers | Smaller scope: showcase + RBAC only |
| **Platforms** | OCP (multiple versions), AKS, EKS, GKE, OSD-GCP | OCP only (single version) |
| **Install methods** | Helm and Operator | Helm only |
| **Alert channel** | `#rhdh-e2e-alerts` / `#rhdh-e2e-alerts-{version}` | PR status checks on GitHub |

**Triggering jobs on a PR**: All nightly job variants can also be triggered on a PR by commenting `/test <job-name>`. Use `/test ?` to list all available jobs for that PR. This is useful for verifying a fix against a specific platform or install method before merging.

---

## How to Use This Guide

This guide is a **reference**, not a textbook. You don't need to read it cover-to-cover before your rotation starts. Instead, use it as a companion that you come back to as situations arise during the week.

### Getting Started (Day 1)

When your rotation begins:

1. **Read the [Overview](#overview)** above to understand the role and where alerts come in.
2. **Familiarize yourself with the [Useful Links and Tools](#useful-links-and-tools)** section -- open the Prow dashboards, join the Slack channels, and make sure you have access.
3. **Review the [Internal Resources doc](https://docs.google.com/document/d/1yiMU-u2v8_rC-TBawcaJwV5jAvWcbTjhspuTe3KNcCo/edit?usp=sharing)** -- it covers Vault secrets, ReportPortal dashboards, DevLake analytics, and how to unredact artifacts. These are internal tools you'll need during triage.
4. **Try the [AI Test Triager](#ai-test-triager-nightly-test-alerts)** on a recent failure in `#rhdh-e2e-alerts` to see how it works. It will handle most of the initial analysis for you.

That's enough to start triaging.

### During Your Rotation

Use the rest of the guide on demand as you encounter specific situations:

| Situation | Section to consult |
|-----------|-------------------|
| A job failed and you need to find the logs | [Where to Find Logs and Artifacts](#where-to-find-logs-and-artifacts) |
| You can't tell *where* in the pipeline it broke | [Job Lifecycle and Failure Points](#job-lifecycle-and-failure-points) |
| You need to understand what a specific job does | [Job Types Reference](#job-types-reference) |
| You're unsure if it's infra, deployment, or a test bug | [Identifying Failure Types](#identifying-failure-types) |
| You need to re-trigger a job or access a cluster | [Useful Links and Tools](#useful-links-and-tools) |

### Understanding the CI Scripts

The guide links heavily to scripts in `.ci/pipelines/`. You don't need to read those scripts upfront either. When you're investigating a failure and need to understand what a specific phase does, follow the links from the relevant [Job Lifecycle](#job-lifecycle-and-failure-points) or [Job Types](#job-types-reference) section to the source code.

Key entry points if you do want to explore:
- [`.ci/pipelines/openshift-ci-tests.sh`](../../.ci/pipelines/openshift-ci-tests.sh) -- the main dispatcher, start here to understand how jobs are routed
- [`.ci/pipelines/jobs/`](../../.ci/pipelines/jobs/) -- one handler per job type, each is self-contained
- [`.ci/pipelines/lib/testing.sh`](../../.ci/pipelines/lib/testing.sh) -- how tests are executed, health-checked, and artifacts collected

### Improving This Guide

This guide is a living document. When you finish your rotation:

- **Update outdated information** -- job names, namespaces, and platform details change over time.
- **Clarify anything that confused you** -- if you had to figure something out the hard way, save the next person the trouble.
- **Remove stale content** -- if a job type or failure mode no longer exists, remove it rather than leaving it to confuse future medics.

Small, incremental improvements after each rotation keep this guide accurate and useful.

---

## Anatomy of a Prow Job

### Job Naming Convention

Nightly jobs follow this pattern:

```
periodic-ci-redhat-developer-rhdh-{BRANCH}-e2e-{PLATFORM}-{INSTALL_METHOD}[-{VARIANT}]-nightly
```

Breaking it down:

| Segment | Values | Meaning |
|---------|--------|---------|
| `{BRANCH}` | `main`, `release-1.9`, `release-1.10` | Git branch being tested |
| `{PLATFORM}` | `ocp`, `ocp-v4-{VER}`, `aks`, `eks`, `gke`, `osd-gcp` | Target platform (OCP versions rotate as new releases come out) |
| `{INSTALL_METHOD}` | `helm`, `operator` | Installation method |
| `{VARIANT}` | `auth-providers`, `upgrade` | Optional -- specialized test scenario |

Examples:

- `periodic-ci-redhat-developer-rhdh-main-e2e-ocp-helm-nightly` -- OCP nightly with Helm on main
- `periodic-ci-redhat-developer-rhdh-release-1.9-e2e-aks-helm-nightly` -- AKS nightly for release 1.9
- `periodic-ci-redhat-developer-rhdh-main-e2e-ocp-operator-nightly` -- OCP nightly with Operator
- `periodic-ci-redhat-developer-rhdh-main-e2e-ocp-operator-auth-providers-nightly` -- Auth provider tests
- `periodic-ci-redhat-developer-rhdh-main-e2e-ocp-helm-upgrade-nightly` -- Upgrade scenario tests

PR check jobs use the `pull-ci-` prefix instead of `periodic-ci-`.

### How the Pipeline Works

[Prow](https://docs.ci.openshift.org/docs/architecture/prow/) is the CI scheduler. It triggers [ci-operator](https://docs.ci.openshift.org/docs/architecture/ci-operator/), which orchestrates the entire workflow:

```
Prow (scheduler)
  └── ci-operator (orchestrator)                        ── openshift/release repo
        ├── 1. Claim/provision cluster:                 ──   (ci-operator config
        │        - OCP: ephemeral cluster from Hive     ──    + step registry)
        │        - AKS/EKS: provisioned on demand via Mapt
        │        - GKE: long-running shared cluster
        ├── 2. Clone rhdh repo & Wait for RHDH image (if it needs to be built) ── openshift/release repo
        ├── 3. Run test step in e2e-runner image        ── rhdh repo
        │     ├── a. Install operators (Tekton, etc.)   ──   (.ci/pipelines/
        │     ├── b. Deploy RHDH (Helm or Operator)     ──    openshift-ci-tests.sh)
        │     ├── c. Wait for deployment health check
        │     ├── d. Run Playwright tests
        │     └── e. Collect artifacts
        ├── 4. Run post-steps                           ── openshift/release repo
        │        (send Slack alert, collect must-gather) ──   (step registry)
        └── 5. Release cluster
```

the test step (2, 3) run inside the [`e2e-runner`](https://quay.io/repository/rhdh-community/rhdh-e2e-runner?tab=tags) image, which is built by a [GitHub Actions workflow](../../.github/workflows/push-e2e-runner.yaml) and mirrored into OpenShift CI.

Each phase can fail independently. Knowing *where* in this pipeline the failure occurred is the first step in triage.

---

## Where to Find Logs and Artifacts

### Navigating the Prow UI

When you click on a failed job (from Slack alert or Prow dashboard), you land on the **Spyglass** view. This page shows:

- **Job metadata**: branch, duration, result
- **Build log**: the top-level `build-log.txt` (ci-operator output)
- **JUnit results**: parsed test results if available (if Playwright ran and test cases failed)
- **Artifacts link**: link to the full GCS artifact tree

### Monitoring a Running PR Check in Real Time

While a PR check is running, you can monitor its live progress, logs, and system resource usage directly in the OpenShift CI cluster console.

**How to find the link:**

1. Open the Prow job page for the PR check (e.g., from the GitHub PR status check "Details" link). The URL looks like:
   ```
   https://prow.ci.openshift.org/view/gs/test-platform-results/pr-logs/pull/redhat-developer_rhdh/{PR_NUMBER}/{JOB_NAME}/{BUILD_ID}
   ```
2. In the **build log**, look for a line near the top like:
   ```
   Using namespace https://console.build08.ci.openshift.org/k8s/cluster/projects/ci-op-XXXXXXXX
   ```
3. Click that link to open the OpenShift console for the CI namespace where the job is running.

**What you can see in the CI namespace:**

- **Pods**: All pods running for the job (test container, sidecar containers, etc.)
- **Pod logs**: Live streaming logs from each container
- **Events**: Kubernetes events (scheduling, image pulls, failures)
- **Resource usage**: CPU and memory metrics for the running pods
- **Terminal**: You can open a terminal into a running pod for live debugging

This is especially useful when:
- A job is hanging and you want to see what it's doing right now
- You need to check pod resource consumption (OOM suspicion)
- You want to watch deployment progress in real time rather than waiting for artifacts

**Logging into the claimed cluster (OCP jobs):** While a job is executing, you can also log into the ephemeral OCP cluster using [`ocp-cluster-claim-login.sh`](../../.ci/pipelines/ocp-cluster-claim-login.sh). See [`.ci/pipelines/README.md`](../../.ci/pipelines/README.md) for prerequisites, access requirements, and usage.

**Prerequisite**: You must be a member of the `openshift` GitHub organization. Request access at [DevServices GitHub Access Request](https://devservices.dpp.openshift.com/support/github_access_request/).

### Artifact Directory Structure

```
artifacts/
├── ci-operator.log                          # ci-operator orchestration log
├── ci-operator-step-graph.json              # Step execution graph with timing
├── {TEST_NAME}/                             # e.g., e2e-ocp-helm-nightly/
│   ├── redhat-developer-rhdh-{STEP}/        # Main test step
│   │   ├── build-log.txt                    # Full output of openshift-ci-tests.sh
│   │   ├── finished.json                    # Exit code and timing
│   │   └── artifacts/                       # Test-generated artifacts
│   │       ├── reporting/                   # Status files consumed by the Slack reporter (`Nightly Test Alerts`)
│   │       ├── showcase/                    # Per-project artifacts
│   │       │   ├── junit-results-showcase.xml
│   │       │   ├── test-log.html            # Playwright output (colorized)
│   │       │   ├── playwright-report/       # Interactive HTML report
│   │       │   ├── test-results/            # Videos, traces per test
│   │       │   └── pod_logs/                # Logs from all pods
│   │       ├── showcase-rbac/               # Same structure as above
│   │       ├── showcase-runtime/
│   │       ├── showcase-sanity-plugins/
│   │       ├── showcase-localization-fr/
│   │       ├── showcase-localization-it/
│   │       └── showcase-localization-ja/
│   ├── gather-must-gather/                  # Cluster diagnostics
│   └── redhat-developer-rhdh-send-alert/    # Slack notification step (`Nightly Test Alerts`)
├── build-resources/                         # Build pod info
│   ├── pods.json
│   └── events.json
└── clone-log.txt                            # Repo cloning output
```

### Key Files to Check (In Order)

1. **`build-log.txt`** (in test step) -- Full script output. Search for `❌` or `Error` to find failures.
2. **Playwright HTML report** -- Detailed test results with screenshots and videos.
3. **`pod_logs/`** -- Pod logs from the RHDH deployment (only collected on failure).

### How to View the Playwright HTML Report

The Playwright report is in `artifacts/{project}/`. To view it:

Open `index.html` in a browser from the GCS artifacts. The report contains per-test pass/fail status with duration, screenshots on failure, video recordings of each failed test, and [trace files](https://playwright.dev/docs/trace-viewer).

---

## Job Lifecycle and Failure Points

### Phase 1: Cluster Provisioning

**What happens**: ci-operator requests a cluster from a pool (OCP) or provisions one via cloud APIs (AKS/EKS/GKE).

**OCP cluster pools** (ephemeral, AWS us-east-2): RHDH uses dedicated Hive cluster pools with the `rhdh` prefix. You can find the current list by filtering for `rhdh` in the [existing cluster pools](https://docs.ci.openshift.org/how-tos/cluster-claim/#existing-cluster-pools) page. See also [`.ci/pipelines/README.md`](../../.ci/pipelines/README.md) for which pool is used by which job.

**What can go wrong**:
- Cluster pool exhausted (no available clusters)
- Cluster claim timeout
- Cluster in unhealthy state

**How to tell**:
- **OCP**: The job shows status `error` (not `failure`) in Prow. Check `build-log.txt` at the top level for cluster provisioning errors.
- **AKS/EKS**: Look for the `create` step in the Prow job artifacts — this is where Mapt provisions the cloud cluster. If it failed, the cluster was never created.

**Action**: Re-trigger the job. This is purely infrastructure.

### Phase 2: Repository Cloning and Test Runner Image

**What happens**: ci-operator clones the repo. The test runner image ([`quay.io/rhdh-community/rhdh-e2e-runner`](https://quay.io/repository/rhdh-community/rhdh-e2e-runner?tab=tags)) is mirrored into OpenShift CI and used to run all test steps starting from `openshift-ci-tests.sh`. The image is built by a [GitHub Actions workflow](../../.github/workflows/push-e2e-runner.yaml) from [`.ci/images/Dockerfile`](../../.ci/images/Dockerfile) and pushed to Quay on every push to `main` or `release-*` branches.

**What can go wrong**:
- Git clone failures (network/GitHub issues)
- Image mirror delay or failure (new image not yet available in CI)

**How to tell**: Check `clone-log.txt` for clone errors. Check `build-resources/builds.json` for image issues.

**Action**: Usually transient -- re-trigger. If the Dockerfile or GitHub Actions workflow changed recently, check the [workflow runs](https://github.com/redhat-developer/rhdh/actions/workflows/push-e2e-runner.yaml) to verify the image was built and pushed successfully.

### Phase 3: Cluster Setup (Operators and Prerequisites)

**What happens**: The [test script](../../.ci/pipelines/openshift-ci-tests.sh) installs required operators and infrastructure (see [operators.sh](../../.ci/pipelines/lib/operators.sh)):
- OpenShift Pipelines (Tekton) operator
- Crunchy PostgreSQL operator
- Orchestrator infrastructure (conditionally, see [orchestrator.sh](../../.ci/pipelines/lib/orchestrator.sh))

**What can go wrong**:
- Operator installation timeout (OperatorHub/Marketplace issues)
- CRD not becoming available
- Tekton webhook deployment not ready

**How to tell**: Search `build-log.txt` for:
- `Failed to install subscription`
- Timeout waiting for operator CRDs
- `Tekton` or `pipeline` related errors early in the log

**Action**: Usually infrastructure -- re-trigger. If operators were recently upgraded, investigate compatibility.

### Phase 4: RHDH Deployment

**What happens**: RHDH is deployed via Helm chart or Operator CR. Health checks poll the Backstage URL.

**Helm deployment flow** (see [helm.sh](../../.ci/pipelines/lib/helm.sh)):
1. Create namespace, RBAC resources, ConfigMaps (see [config.sh](../../.ci/pipelines/lib/config.sh))
2. Deploy Redis cache
3. Deploy PostgreSQL (for RBAC namespace)
4. Deploy RHDH via `helm upgrade --install`
5. Poll health endpoint (up to 30 attempts, 30 seconds apart) via [testing.sh](../../.ci/pipelines/lib/testing.sh)

**Operator deployment flow** (see [operator.sh](../../.ci/pipelines/install-methods/operator.sh)):
1. Install RHDH Operator
2. Wait for `backstages.rhdh.redhat.com` CRD (300s timeout)
3. Create ConfigMaps for dynamic plugins
4. Apply Backstage CR ([`rhdh-start.yaml`](../../.ci/pipelines/resources/rhdh-operator/rhdh-start.yaml) or [`rhdh-start-rbac.yaml`](../../.ci/pipelines/resources/rhdh-operator/rhdh-start-rbac.yaml))
5. Poll health endpoint

**What can go wrong**:
- Helm chart errors (invalid values, missing CRDs)
- Pod stuck in `CrashLoopBackOff` (bad config, missing secrets, image pull failure)
- Health check timeout (`Failed to reach Backstage after N attempts`)
- PostgreSQL operator fails to create user secret (`postgress-external-db-pguser-janus-idp`)

**How to tell**: Search `build-log.txt` for:
- `CrashLoopBackOff` -- pod is crash-looping
- `Failed to reach Backstage` -- health check timeout
- `helm upgrade` failures
- `Crunchy Postgres operator failed to create the user` -- PostgreSQL setup issue
- Check `pod_logs/` for application-level errors

**Action**: Check pod logs and events in artifacts. May be a config issue (real bug) or transient infra (re-trigger).

### Phase 5: Test Execution

**What happens**: Playwright tests run inside the test container against the deployed RHDH instance (see [testing.sh](../../.ci/pipelines/lib/testing.sh)). For test configuration details (timeouts, retries, workers), see [`playwright.config.ts`](../../e2e-tests/playwright.config.ts). For project names, see [`projects.json`](../../e2e-tests/playwright/projects.json).

**What can go wrong**:
- Individual test failures (assertions, timeouts, element not found)
- Authentication/login failures (Keycloak issues)
- API timeouts (external service dependencies)
- Flaky tests (pass on retry but show up in JUnit XML as failures)

**How to tell**: This is the most common scenario. Look at:
- `junit-results-{project}.xml` -- which tests failed
- Playwright HTML report -- detailed failure info with screenshots/videos
- `test-log.html` -- full Playwright console output

**Important**: The Playwright exit code is the source of truth. Exit code `0` means all tests ultimately passed (even if some were retried). JUnit XML may still report initial failures for retried tests.

**Action**: Review the specific test failures. Check if the failure is:
- **Flaky**: Passed on retry -- file a flaky test ticket
- **Consistent**: Fails across retries -- real bug, investigate further
- **Broad**: Many tests fail in the same way -- likely a deployment/config issue, not individual test bugs

### Phase 6: Artifact Collection and Reporting

**What happens**: Test results, pod logs, screenshots, and videos are collected. Status files are written (see [reporting.sh](../../.ci/pipelines/reporting.sh) and [test-run-tracker.sh](../../.ci/pipelines/lib/test-run-tracker.sh)). A Slack alert is sent via the [send-alert step](https://github.com/openshift/release/tree/master/ci-operator/step-registry/redhat-developer/rhdh/send/alert).

**What can go wrong**: Rarely fails, but if it does, you may not get artifacts or Slack notification. Check the Prow UI directly.

---

## Job Types Reference

### OCP Nightly (`ocp-nightly`)

The most comprehensive nightly job. Runs on OpenShift using ephemeral cluster claims. See [`ocp-nightly.sh`](../../.ci/pipelines/jobs/ocp-nightly.sh).

**Namespaces**: `showcase-ci-nightly`, `showcase-rbac-nightly`, `postgress-external-db-nightly`, plus a runtime namespace for `showcase-runtime` tests

**Test suites run (in order)**:
1. **Standard deployment tests** (`showcase`, `showcase-rbac`) -- core functionality with and without RBAC
2. **Runtime config change tests** (`showcase-runtime`) -- tests that modify RHDH configuration at runtime
3. **Sanity plugins check** (`showcase-sanity-plugins`) -- validates plugin loading and basic functionality
4. **Localization tests** (`showcase-localization-fr`, `showcase-localization-it`, `showcase-localization-ja`) -- UI translations

**OSD-GCP variant**: Nightly tests on OpenShift Dedicated on GCP. Uses the same handler but orchestrator is disabled and localization tests are skipped.

### OCP Operator (`ocp-operator`)

Same as OCP nightly but deploys RHDH using the Operator instead of Helm. See [`ocp-operator.sh`](../../.ci/pipelines/jobs/ocp-operator.sh).

**Namespaces**: `showcase`, `showcase-rbac`, `showcase-runtime` (when runtime tests are enabled)

**Test suites**: `showcase-operator`, `showcase-operator-rbac`

**Key differences**:
- Installs RHDH Operator and waits for `backstages.rhdh.redhat.com` CRD (300s timeout)
- Uses Backstage CR (`rhdh-start.yaml`) instead of Helm release
- Orchestrator workflows currently disabled (tracked in RHDHBUGS-2184)
- Runtime config tests currently commented out (tracked in RHDHBUGS-2608)

### OCP PR Check (`ocp-pull`)

Runs on every PR that modifies e2e test code. Smaller scope for faster feedback. See [`ocp-pull.sh`](../../.ci/pipelines/jobs/ocp-pull.sh).

**Namespaces**: `showcase`, `showcase-rbac`

**Test suites**: `showcase`, `showcase-rbac` only

**Key differences**:
- No runtime, sanity plugin, or localization tests
- No orchestrator infrastructure setup
- Deploys test Backstage customization provider

### Auth Providers (`auth-providers`)

Tests authentication provider integrations. Has a completely different deployment approach. See [`auth-providers.sh`](../../.ci/pipelines/jobs/auth-providers.sh).

**Namespace**: `showcase-auth-providers` (dedicated)

**Release name**: `rhdh-auth-providers`

**Providers tested**:
- OIDC via Red Hat Backstage Keycloak (RHBK)
- Microsoft OAuth2
- GitHub authentication
- LDAP / Active Directory (may be commented out)

**Key differences**:
- Uses RHDH **Operator** for deployment (not Helm)
- TypeScript-based test configuration (not Bash scripts) -- see [auth-providers test directory](../../e2e-tests/playwright/e2e/auth-providers/)
- Dedicated values file: [`values_showcase-auth-providers.yaml`](../../.ci/pipelines/value_files/values_showcase-auth-providers.yaml)
- Only **1 retry** (vs 2 for other projects) -- due to complex auth setup/teardown
- Dedicated logs folder: `e2e-tests/auth-providers-logs`
- Requires specific plugins: `keycloak-dynamic`, `github-org-dynamic`, `msgraph-dynamic`, `rbac`

### Upgrade (`upgrade`)

Tests upgrading RHDH from a previous version to the current one. See [`upgrade.sh`](../../.ci/pipelines/jobs/upgrade.sh).

**Namespace**: `showcase-upgrade-nightly`

**Flow**:
1. Dynamically determine the previous release version
2. Deploy RHDH at the previous version
3. Deploy orchestrator workflows on the previous version
4. Upgrade to the current version
5. Run upgrade-specific Playwright tests

**Common failures**: Version detection issues, database migration failures during upgrade, backward compatibility problems.

### AKS Helm / AKS Operator

Tests on Azure Kubernetes Service. See [`aks-helm.sh`](../../.ci/pipelines/jobs/aks-helm.sh) / [`aks-operator.sh`](../../.ci/pipelines/jobs/aks-operator.sh).

**Namespaces**: `showcase-k8s-ci-nightly`, `showcase-rbac-k8s-ci-nightly`

**Test suites**: `showcase-k8s`, `showcase-rbac-k8s`

**Common failures**: Most failures are either [Mapt](https://github.com/redhat-developer/mapt) failing to create the cluster (check the `create` step in artifacts) or the cluster being slower than OCP, causing timeouts during deployment or networking setup. Re-trigger in both cases.

### EKS Helm / EKS Operator

Tests on AWS Elastic Kubernetes Service. See [`eks-helm.sh`](../../.ci/pipelines/jobs/eks-helm.sh) / [`eks-operator.sh`](../../.ci/pipelines/jobs/eks-operator.sh). AWS utilities in [`aws.sh`](../../.ci/pipelines/cluster/eks/aws.sh).

**Namespaces**: `showcase-k8s-ci-nightly`, `showcase-rbac-k8s-ci-nightly`

**Test suites**: `showcase-k8s`, `showcase-rbac-k8s`

**Platform specifics** (DNS/cert logic in [`aws.sh`](../../.ci/pipelines/cluster/eks/aws.sh)):
- **Dynamic DNS**: Generates domain names (`eks-ci-{N}.{region}.{parent-domain}`), tries up to 50 numbers
- **AWS Certificate Manager**: Requests/retrieves SSL certificates per domain. DNS validation with Route53.
- **ALB ingress controller**: AWS Application Load Balancer with SSL redirect -- see [`eks-operator-ingress.yaml`](../../.ci/pipelines/cluster/eks/manifest/eks-operator-ingress.yaml)
- **External DNS**: Automatically creates Route53 records from ingress annotations

**Common failures**: Usually AWS resource limits (domain slots, certificates, Route53 throttling). If persistent, check the job handler for which resource is exhausted.

### GKE Helm / GKE Operator

Tests on Google Kubernetes Engine. See [`gke-helm.sh`](../../.ci/pipelines/jobs/gke-helm.sh) / [`gke-operator.sh`](../../.ci/pipelines/jobs/gke-operator.sh). GCP utilities in [`gcloud.sh`](../../.ci/pipelines/cluster/gke/gcloud.sh).

**Namespaces**: `showcase-k8s-ci-nightly`, `showcase-rbac-k8s-ci-nightly`

**Test suites**: `showcase-k8s`, `showcase-rbac-k8s`

**Platform specifics** (cert logic in [`gcloud.sh`](../../.ci/pipelines/cluster/gke/gcloud.sh)):
- Uses a **long-running cluster** (not ephemeral like OCP)
- Google-managed SSL certificates via `gcloud`
- GCE ingress class with FrontendConfig for SSL policy and HTTPS redirect -- see [`frontend-config.yaml`](../../.ci/pipelines/cluster/gke/manifest/frontend-config.yaml) and [`gke-operator-ingress.yaml`](../../.ci/pipelines/cluster/gke/manifest/gke-operator-ingress.yaml)

**Common failures**: Since GKE uses a long-running shared cluster, most issues stem from stale state -- a previous job exited without proper cleanup, or two jobs were triggered at the same time and collided on shared resources (namespaces, certificates, static IP). If jobs overlap, adjust the cron schedule in the [ci-operator config](https://github.com/openshift/release/tree/master/ci-operator/config/redhat-developer/rhdh) to space them out.

---

## Identifying Failure Types

### Infrastructure Failure

The job never got to run tests. Something went wrong with the CI platform itself.

**Indicators**:
- Prow shows the job as `error` (red circle) rather than `failure` (red X)
- Failure is in `build-log.txt` (top level), not in the test step
- `ci-operator.log` shows provisioning or setup errors
- No test artifacts for RHDH exist at all

**Where to look**:
- Top-level `build-log.txt`
- `ci-operator.log`
- `ci-operator-step-graph.json` -- shows which step failed

**Common causes**:
- Cluster pool exhaustion
- Cloud provider API failures (AKS/EKS/GKE auth, quota)
- Network/DNS issues at the CI level
- Image or the image registry unavailable

**Action**: Re-trigger the job. If it persists across multiple runs, escalate to CI platform team.

### Deployment Failure

The cluster was provisioned, but RHDH failed to deploy or start properly.

**Indicators**:
- `build-log.txt` (test step) shows deployment errors before any test execution
- `pod_logs/` contain application crash logs
- No JUnit XML or Playwright report exists for that namespace

**Where to look**:
- Test step `build-log.txt` -- search for `CrashLoopBackOff`, `Failed to reach Backstage`, `helm upgrade` errors
- `pod_logs/` -- check RHDH container logs for startup errors
- Kubernetes events -- look for `ImagePullBackOff`, `FailedScheduling`, etc.

**Common causes**:
- Bad configuration in ConfigMaps (see [`resources/config_map/`](../../.ci/pipelines/resources/config_map/)) or values files (see [`value_files/`](../../.ci/pipelines/value_files/))
- Image pull failures (wrong tag, registry auth, rate limiting)
- Resource constraints (OOM, CPU limits)
- Operator CRD not available in time

**Action**: Investigate the specific error. If it's a config change in a recent PR, that PR likely caused it. If it's transient (image pull timeout), re-trigger.

### Test Failure

RHDH deployed successfully, but one or more Playwright tests failed.

**Indicators**:
- JUnit XML and Playwright report exist with specific test failures

**Where to look**:
- Playwright HTML report -- screenshots, videos, error messages
- `test-log.html` -- full console output of the test run
- `pod_logs/` -- if the test failure suggests a backend issue

**Subcategories**:

| Pattern | Likely Cause | Action |
|---------|-------------|--------|
| Single test fails, passes on retry | Flaky test | File flaky test ticket |
| Single test fails consistently | Real test bug or app regression | Investigate, file bug |
| Many tests timeout | App slow or partially broken | Check pod logs, resource usage |
| All tests fail uniformly | Deployment issue not caught by health check | Treat as deployment failure |

---

## Finding Past Failures

Instead of maintaining a static cheat sheet that goes stale, use these two sources to find how similar failures were investigated and resolved in the past:

### AI Test Triager

The **AI Test Triager** (`@Nightly Test Alerts` Slack app) is your first stop for any failure. It automatically analyzes failed nightly jobs, provides root cause analysis, and searches Jira for similar existing issues. See [AI Test Triager](#ai-test-triager-nightly-test-alerts) for details.

### Resolved Jira `ci-fail` Issues

Previously resolved CI failures are tracked in Jira with the **`ci-fail`** label. Search for resolved issues to find patterns, root causes, and fixes for failures you're seeing:

- [Resolved `ci-fail` issues (RHDHBUGS)](https://redhat.atlassian.net/issues/?jql=project%20%3D%20RHDHBUGS%20AND%20labels%20%3D%20ci-fail%20AND%20status%20in%20(Done%2C%20Closed)%20ORDER%20BY%20resolved%20DESC)

When investigating a failure, search these resolved issues for keywords from the error message (e.g., `CrashLoopBackOff`, `Failed to reach Backstage`, `ImagePullBackOff`). The resolution comments often describe exactly what was wrong and how it was fixed.

---

## Useful Links and Tools

### AI Test Triager (`@Nightly Test Alerts`)

The **AI Test Triager** is an automated analysis tool integrated into the `@Nightly Test Alerts` Slack app. It significantly speeds up the triage process by doing much of the investigation work for you.

**How it works**:
- **Automatically triggered** on every failed nightly job -- the analysis appears alongside the failure alert in Slack.
- **Manually invoked** by tagging `@Nightly Test Alerts` in Slack when you want to analyze a specific failure.

**What it does**:

| Capability | Description |
|------------|-------------|
| **Artifact inspection** | Reads `build-log.txt`, locates JUnit results, screenshots, and pod logs |
| **JUnit parsing** | Extracts only failed test cases with clean error messages |
| **Screenshot analysis** | Uses AI vision to interpret failure screenshots and identify what went wrong on screen |
| **Root cause analysis** | Provides a concise 1-2 sentence diagnosis of each failure |
| **Duplicate detection** | Searches Jira for semantically similar existing issues to avoid duplicates |
| **Bug creation** | Can create or update Jira bug tickets with detailed findings |

**Recommended workflow**:
1. A nightly job fails and the alert appears in Slack with the AI analysis.
2. Review the AI triager's root cause analysis and similar Jira issues.
3. If it's a known issue, confirm and move on.
4. If it's a new issue, use the triager's output to create a Jira bug (it can do this for you) or investigate further manually.

### Prow Dashboard

| Link | Description |
|------|-------------|
| [Nightly Jobs (main)](https://prow.ci.openshift.org/?type=periodic&job=periodic-ci-redhat-developer-rhdh-main-e2e-*) | All main branch nightly jobs |
| [Nightly Jobs (all branches)](https://prow.ci.openshift.org/?type=periodic&job=periodic-ci-redhat-developer-rhdh-*-e2e-*) | All nightly jobs across branches |
| [PR Check Jobs](https://prow.ci.openshift.org/?type=presubmit&job=pull-ci-redhat-developer-rhdh-*-e2e-*) | PR presubmit jobs |
| [Configured Jobs](https://prow.ci.openshift.org/configured-jobs/redhat-developer/rhdh) | All configured jobs for the repo |
| [Job History (example)](https://prow.ci.openshift.org/job-history/gs/test-platform-results/logs/periodic-ci-redhat-developer-rhdh-main-e2e-ocp-helm-nightly) | Historical runs for a specific job |

### Accessing Artifacts Directly

Artifacts are stored in GCS. You can browse them via:

- **Spyglass** (Prow UI): Click on a job run, then navigate the artifacts tree
- **GCS Web**: `https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results/logs/{JOB_NAME}/{BUILD_ID}/`

### Cluster Access (OCP Jobs Only)

Use [`.ci/pipelines/ocp-cluster-claim-login.sh`](../../.ci/pipelines/ocp-cluster-claim-login.sh) to log into the ephemeral cluster of a running or recent OCP job. See [`.ci/pipelines/README.md`](../../.ci/pipelines/README.md) for prerequisites and usage.

### Re-triggering a Nightly Job

Use [`.ci/pipelines/trigger-nightly-job.sh`](../../.ci/pipelines/trigger-nightly-job.sh) to re-run a failed nightly job. Run with `--help` for all options. You can also use the `/trigger-nightly-job` AI command to trigger jobs interactively.

### Related Documentation

- [Internal Resources (Google Doc)](https://docs.google.com/document/d/1yiMU-u2v8_rC-TBawcaJwV5jAvWcbTjhspuTe3KNcCo/edit?usp=sharing) -- Vault secrets, ReportPortal, DevLake, unredacting artifacts (Red Hat internal)
- [`.ci/pipelines/README.md`](../../.ci/pipelines/README.md) -- cluster pools, access requirements, development guidelines
- [`.ci/pipelines/lib/README.md`](../../.ci/pipelines/lib/README.md) -- full list of pipeline library modules and function signatures
- [`CI.md`](CI.md) -- CI testing processes, job definitions, openshift/release repo links
- [OpenShift CI Documentation](https://docs.ci.openshift.org/) -- Prow, ci-operator, cluster pools, artifacts
