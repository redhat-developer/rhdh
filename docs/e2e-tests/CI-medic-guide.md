# CI Medic Guide

A practical guide for investigating test failures in RHDH nightly jobs and PR checks.

## Table of Contents

- [Overview](#overview)
- [Anatomy of a Prow Job](#anatomy-of-a-prow-job)
- [Where to Find Logs and Artifacts](#where-to-find-logs-and-artifacts)
- [Job Lifecycle and Failure Points](#job-lifecycle-and-failure-points)
- [Job Types Reference](#job-types-reference)
- [Identifying Failure Types](#identifying-failure-types)
- [Common Failure Patterns (Cheat Sheet)](#common-failure-patterns-cheat-sheet)
- [Useful Links and Tools](#useful-links-and-tools)
- [AI Test Triager](#ai-test-triager-nightly-test-alerts)

---

## Overview

### What is a CI Medic?

The CI medic is a **weekly rotating role** responsible for maintaining the health of PR checks and nightly E2E test jobs. When your rotation starts, you'll receive a Slack message with your responsibilities.

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
- **Getting help**: `#forum-ocp-testplatform` (ask questions about CI platform issues)

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

**Logging into the claimed cluster (OCP jobs):** While a job is executing, you can also log into the ephemeral OCP cluster where RHDH is being deployed and tested. Use the [`ocp-cluster-claim-login.sh`](../../.ci/pipelines/ocp-cluster-claim-login.sh) script:

```bash
# Provide the Prow job URL
.ci/pipelines/ocp-cluster-claim-login.sh "https://prow.ci.openshift.org/view/gs/..."
```

This gives you direct `oc` access to the cluster, allowing you to inspect pods, check logs, describe resources, and debug issues live. See [Cluster Access](#cluster-access-ocp-jobs-only) for details.

**Prerequisite**: You must be a member of the `openshift` GitHub organization. Request access at [DevServices GitHub Access Request](https://devservices.dpp.openshift.com/support/github_access_request/). For cluster login, you also need to be in the `rhdh-pool-admins` [Rover group](https://rover.redhat.com/groups/search?q=rhdh-pool-admins).

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

**What happens**: Playwright tests run inside the test container against the deployed RHDH instance (see [testing.sh](../../.ci/pipelines/lib/testing.sh)).

```bash
yarn playwright test --project="${playwright_project}"
```

Tests are configured in [`playwright.config.ts`](../../e2e-tests/playwright.config.ts) with:
- **Timeout**: 90 seconds per test
- **Retries**: 2 on CI (1 for auth-providers)
- **Workers**: 3 parallel
- **Viewport**: 1920x1080

Project names are defined in [`projects.json`](../../e2e-tests/playwright/projects.json) (single source of truth) and loaded by CI via [`playwright-projects.sh`](../../.ci/pipelines/playwright-projects.sh).

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

**OSD-GCP variant**: When the job name contains `osd-gcp`, orchestrator is disabled and localization tests are skipped.

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

**Platform specifics**:
- Uses Azure Spot VMs -- pods may be preempted mid-test (tolerations/affinity patches via [`aks-spot-patch.yaml`](../../.ci/pipelines/cluster/aks/patch/aks-spot-patch.yaml))
- Ingress via Azure Web App Routing controller (`webapprouting.kubernetes.azure.com`) -- see [`aks-operator-ingress.yaml`](../../.ci/pipelines/cluster/aks/manifest/aks-operator-ingress.yaml)
- Gets LoadBalancer IP from `app-routing-system` namespace (`nginx` service)
- Image pull secrets from Red Hat registry required

**Common failures**:
- Spot VM preemption causing pod evictions
- LoadBalancer IP not obtained (check `app-routing-system` namespace)
- Azure API throttling
- Image pull failures from Red Hat registry

### EKS Helm / EKS Operator

Tests on AWS Elastic Kubernetes Service. See [`eks-helm.sh`](../../.ci/pipelines/jobs/eks-helm.sh) / [`eks-operator.sh`](../../.ci/pipelines/jobs/eks-operator.sh). AWS utilities in [`aws.sh`](../../.ci/pipelines/cluster/eks/aws.sh).

**Namespaces**: `showcase-k8s-ci-nightly`, `showcase-rbac-k8s-ci-nightly`

**Test suites**: `showcase-k8s`, `showcase-rbac-k8s`

**Platform specifics** (DNS/cert logic in [`aws.sh`](../../.ci/pipelines/cluster/eks/aws.sh)):
- **Dynamic DNS**: Generates domain names (`eks-ci-{N}.{region}.{parent-domain}`), tries up to 50 numbers
- **AWS Certificate Manager**: Requests/retrieves SSL certificates per domain. DNS validation with Route53.
- **ALB ingress controller**: AWS Application Load Balancer with SSL redirect -- see [`eks-operator-ingress.yaml`](../../.ci/pipelines/cluster/eks/manifest/eks-operator-ingress.yaml)
- **External DNS**: Automatically creates Route53 records from ingress annotations

**Network setup flow**:
1. Generate unique domain name and reserve in Route53
2. Request certificate from ACM, wait for DNS validation (up to 30 minutes)
3. Deploy with ALB ingress, get LoadBalancer hostname
4. Update Route53 CNAME to point to ALB
5. Verify DNS resolution (30 attempts, 15 second intervals)

**Common failures**:
- Domain number exhaustion (50 limit)
- Certificate issuance delays or validation failures (ACM)
- DNS propagation delays (can take 15-30 minutes)
- Route53 API throttling
- ALB creation/deletion race conditions

**Cleanup**: Route53 DNS records are deleted after test completion.

### GKE Helm / GKE Operator

Tests on Google Kubernetes Engine. See [`gke-helm.sh`](../../.ci/pipelines/jobs/gke-helm.sh) / [`gke-operator.sh`](../../.ci/pipelines/jobs/gke-operator.sh). GCP utilities in [`gcloud.sh`](../../.ci/pipelines/cluster/gke/gcloud.sh).

**Namespaces**: `showcase-k8s-ci-nightly`, `showcase-rbac-k8s-ci-nightly`

**Test suites**: `showcase-k8s`, `showcase-rbac-k8s`

**Platform specifics** (cert logic in [`gcloud.sh`](../../.ci/pipelines/cluster/gke/gcloud.sh)):
- Uses a **long-running cluster** (not ephemeral like OCP)
- Pre-provisioned static IP: `rhdh-static-ip`
- Google-managed SSL certificates via `gcloud`
- GCE ingress class with FrontendConfig for SSL policy and HTTPS redirect -- see [`frontend-config.yaml`](../../.ci/pipelines/cluster/gke/manifest/frontend-config.yaml) and [`gke-operator-ingress.yaml`](../../.ci/pipelines/cluster/gke/manifest/gke-operator-ingress.yaml)
- Ingress annotation: `ingress.gcp.kubernetes.io/pre-shared-cert`

**Common failures**:
- SSL certificate creation delays (CA issuance timing)
- Static IP already in use or unavailable
- GCP quota limits on certificates/IPs
- Cloud Load Balancer propagation delays
- FrontendConfig not applying (timing issues)

---

## Identifying Failure Types

### Infrastructure Failure

The job never got to run tests. Something went wrong with the CI platform itself.

**Indicators**:
- Prow shows the job as `error` (red circle) rather than `failure` (red X)
- Failure is in `build-log.txt` (top level), not in the test step
- `ci-operator.log` shows provisioning or setup errors
- No test artifacts exist at all

**Where to look**:
- Top-level `build-log.txt`
- `ci-operator.log`
- `ci-operator-step-graph.json` -- shows which step failed

**Common causes**:
- Cluster pool exhaustion
- Cloud provider API failures (AKS/EKS/GKE auth, quota)
- Operator marketplace down
- Network/DNS issues at the CI level
- Image registry unavailable

**Action**: Re-trigger the job. If it persists across multiple runs, escalate to CI platform team.

### Deployment Failure

The cluster was provisioned, but RHDH failed to deploy or start properly.

**Indicators**:
- `STATUS_FAILED_TO_DEPLOY.txt` contains `true` for one or more namespaces
- `build-log.txt` (test step) shows deployment errors before any test execution
- `pod_logs/` contain application crash logs
- No JUnit XML or Playwright report exists for that namespace

**Where to look**:
- Test step `build-log.txt` -- search for `CrashLoopBackOff`, `Failed to reach Backstage`, `helm upgrade` errors
- `pod_logs/` -- check RHDH container logs for startup errors
- Kubernetes events -- look for `ImagePullBackOff`, `FailedScheduling`, etc.

**Common causes**:
- Bad configuration in ConfigMaps (see [`resources/config_map/`](../../.ci/pipelines/resources/config_map/)) or values files (see [`value_files/`](../../.ci/pipelines/value_files/))
- Missing secrets (especially PostgreSQL user secret for RBAC)
- Image pull failures (wrong tag, registry auth, rate limiting)
- Resource constraints (OOM, CPU limits)
- Operator CRD not available in time

**Action**: Investigate the specific error. If it's a config change in a recent PR, that PR likely caused it. If it's transient (image pull timeout), re-trigger.

### Test Failure

RHDH deployed successfully, but one or more Playwright tests failed.

**Indicators**:
- `STATUS_FAILED_TO_DEPLOY.txt` is `false` (deployment succeeded)
- `STATUS_TEST_FAILED.txt` is `true`
- JUnit XML and Playwright report exist with specific test failures
- `STATUS_NUMBER_OF_TEST_FAILED.txt` shows the count

**Where to look**:
- `junit-results-{project}.xml` -- which tests failed
- Playwright HTML report -- screenshots, videos, error messages
- `test-log.html` -- full console output of the test run
- `pod_logs/` -- if the test failure suggests a backend issue

**Subcategories**:

| Pattern | Likely Cause | Action |
|---------|-------------|--------|
| Single test fails, passes on retry | Flaky test | File flaky test ticket |
| Single test fails consistently | Real test bug or app regression | Investigate, file bug |
| Login/auth tests fail | Keycloak or auth provider issue | Check Keycloak pod logs |
| Many tests timeout | App slow or partially broken | Check pod logs, resource usage |
| All tests fail uniformly | Deployment issue not caught by health check | Treat as deployment failure |

---

## Common Failure Patterns (Cheat Sheet)

| Symptom | Type | Where to Look | Likely Cause | Action |
|---------|------|---------------|--------------|--------|
| Job status is `error` (not `failure`) | Infra | Top-level `build-log.txt` | Cluster provisioning failed | Re-trigger |
| `failed to acquire cluster lease` | Infra | `ci-operator.log` | Cluster pool exhausted | Wait and re-trigger |
| `CrashLoopBackOff` in test step log | Deploy | `pod_logs/`, K8s events | Bad config, missing secret, OOM | Check pod logs |
| `Failed to reach Backstage after N attempts` | Deploy | Test step `build-log.txt` | Pod didn't start or health check path wrong | Check pod logs, events |
| `postgress-external-db-pguser-janus-idp` secret timeout | Deploy | Test step log | Crunchy Postgres operator issue | Check operator logs |
| `Failed to install subscription` | Infra/Deploy | Test step `build-log.txt` | OperatorHub/Marketplace issue | Re-trigger, check OLM |
| `ImagePullBackOff` or `ErrImagePull` | Deploy | K8s events, pod describe | Wrong image tag or registry auth | Verify image exists, check pull secrets |
| `helm upgrade` command fails | Deploy | Test step `build-log.txt` | Invalid values, missing CRDs | Check recent values file changes |
| Playwright timeout on login page | Test | HTML report, videos | Keycloak down or misconfigured | Check Keycloak pod logs |
| `backstages.rhdh.redhat.com` CRD timeout | Deploy | Test step log | RHDH Operator not installed | Check operator subscription |
| Test passes on retry (flaky) | Test | JUnit XML (failures > 0 but exit 0) | Non-deterministic test | File flaky test ticket |
| All tests fail with same error | Deploy | Pod logs, HTML report | App not functional despite health check | Investigate app state |
| Certificate issuance timeout (EKS/GKE) | Infra | Test step `build-log.txt` | ACM/GCP cert delays | Re-trigger |
| DNS resolution failure (EKS) | Infra | Test step `build-log.txt` | Route53 propagation delay | Re-trigger |
| Spot VM preemption (AKS) | Infra | K8s events | Azure reclaimed spot instance | Re-trigger |
| `LoadBalancer` IP not obtained (K8s) | Infra | Test step `build-log.txt` | Ingress controller issue | Check ingress controller pods |
| Domain number exhaustion (EKS) | Infra | Test step `build-log.txt` | All 50 domain slots taken | Manual DNS cleanup needed |

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

To log into the ephemeral cluster of a running or recent OCP job:

```bash
.ci/pipelines/ocp-cluster-claim-login.sh
# Or provide the Prow URL directly:
.ci/pipelines/ocp-cluster-claim-login.sh "https://prow.ci.openshift.org/view/gs/..."
```

The script will:
1. Extract the cluster namespace from the Prow build log
2. Log into the hosted-mgmt cluster
3. Retrieve `kubeadmin` credentials
4. Log into the ephemeral cluster
5. Offer to open the web console (copies password to clipboard)

**Requirements**: You must be a member of the `rhdh-pool-admins` [Rover group](https://rover.redhat.com/groups/search?q=rhdh-pool-admins).

**Important**: Ephemeral clusters are deleted when the CI job terminates. You can only access them while the job is running or shortly after.

### Re-triggering a Nightly Job

Use the trigger script to re-run a failed nightly job:

```bash
# Basic re-trigger
.ci/pipelines/trigger-nightly-job.sh --job periodic-ci-redhat-developer-rhdh-main-e2e-ocp-helm-nightly

# Dry run (preview without triggering)
.ci/pipelines/trigger-nightly-job.sh --job <JOB_NAME> --dry-run

# With custom image (e.g., RC verification)
.ci/pipelines/trigger-nightly-job.sh --job <JOB_NAME> --quay-repo rhdh/rhdh-hub-rhel9 --tag 1.9-123

# With Slack alerts enabled
.ci/pipelines/trigger-nightly-job.sh --job <JOB_NAME> --send-alerts
```

**Authentication**: The script uses a dedicated kubeconfig at `~/.config/openshift-ci/kubeconfig`. If the token is expired, it will open a browser for SSO login.

### CI Configuration (openshift/release repo)

The Prow job definitions and ci-operator configs live in the [openshift/release](https://github.com/openshift/release) repo:

| Path | Description |
|------|-------------|
| [`ci-operator/config/redhat-developer/rhdh/`](https://github.com/openshift/release/tree/master/ci-operator/config/redhat-developer/rhdh) | ci-operator configuration files |
| [`ci-operator/jobs/redhat-developer/rhdh/`](https://github.com/openshift/release/tree/master/ci-operator/jobs/redhat-developer/rhdh) | Generated Prow job definitions |
| [`ci-operator/step-registry/redhat-developer/rhdh/`](https://github.com/openshift/release/tree/master/ci-operator/step-registry/redhat-developer/rhdh) | Step registry (test steps, alert sending) |

### Documentation

| Resource | Link |
|----------|------|
| OpenShift CI Documentation | [docs.ci.openshift.org](https://docs.ci.openshift.org/) |
| ci-operator Architecture | [ci-operator docs](https://docs.ci.openshift.org/docs/architecture/ci-operator/) |
| Artifacts Documentation | [Artifacts how-to](https://docs.ci.openshift.org/docs/how-tos/artifacts/) |
| Prow Overview | [Prow docs](https://docs.ci.openshift.org/docs/architecture/prow/) |
| Cluster Pools & Claims | [Cluster pools docs](https://docs.ci.openshift.org/docs/how-tos/cluster-claim/) |
| RHDH CI Pipeline README | [`.ci/pipelines/README.md`](../../.ci/pipelines/README.md) |
| E2E Testing CI Documentation | [`CI.md`](CI.md) |
| Playwright Documentation | [playwright.dev](https://playwright.dev/) |
| Playwright Trace Viewer | [Trace viewer docs](https://playwright.dev/docs/trace-viewer) |

### Key Files in This Repo

| File | Purpose |
|------|---------|
| [`.ci/pipelines/openshift-ci-tests.sh`](../../.ci/pipelines/openshift-ci-tests.sh) | Main entry point -- dispatches to job handlers |
| [`.ci/pipelines/lib/testing.sh`](../../.ci/pipelines/lib/testing.sh) | Test execution, health checks, artifact collection |
| [`.ci/pipelines/lib/log.sh`](../../.ci/pipelines/lib/log.sh) | Structured logging (log levels, colors, sections) |
| [`.ci/pipelines/reporting.sh`](../../.ci/pipelines/reporting.sh) | Status tracking and result persistence |
| [`.ci/pipelines/env_variables.sh`](../../.ci/pipelines/env_variables.sh) | Environment variables and secrets |
| [`.ci/pipelines/jobs/`](../../.ci/pipelines/jobs/) | Per-job-type handlers (ocp-nightly, aks-helm, etc.) |
| [`.ci/pipelines/trigger-nightly-job.sh`](../../.ci/pipelines/trigger-nightly-job.sh) | Manual nightly job trigger via Gangway API |
| [`.ci/pipelines/ocp-cluster-claim-login.sh`](../../.ci/pipelines/ocp-cluster-claim-login.sh) | Cluster access for debugging |
| [`e2e-tests/playwright/projects.json`](../../e2e-tests/playwright/projects.json) | Playwright project definitions (source of truth) |
| [`e2e-tests/playwright.config.ts`](../../e2e-tests/playwright.config.ts) | Playwright configuration (timeouts, retries, workers) |
| [`.ci/pipelines/lib/config.sh`](../../.ci/pipelines/lib/config.sh) | ConfigMap selection and app-config management |
| [`.ci/pipelines/lib/operators.sh`](../../.ci/pipelines/lib/operators.sh) | Operator/OLM installation functions |
| [`.ci/pipelines/lib/helm.sh`](../../.ci/pipelines/lib/helm.sh) | Helm chart operations and value merging |
| [`.ci/pipelines/lib/namespace.sh`](../../.ci/pipelines/lib/namespace.sh) | Namespace lifecycle and image pull secrets |
| [`.ci/pipelines/cleanup.sh`](../../.ci/pipelines/cleanup.sh) | Exit trap for cleanup |
| [`.ci/pipelines/resources/config_map/`](../../.ci/pipelines/resources/config_map/) | App-config YAML files (RBAC and non-RBAC variants) |
| [`.ci/pipelines/value_files/`](../../.ci/pipelines/value_files/) | Helm values overrides for different platforms |
