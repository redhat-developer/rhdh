---
name: e2e-deploy-rhdh
description: >-
  Deploy RHDH to an OpenShift cluster using local-run.sh for E2E test execution,
  with autonomous error recovery for deployment failures
---
# Deploy RHDH

Deploy Red Hat Developer Hub to a cluster for E2E test execution using the existing `local-run.sh` workflow.

## When to Use

Use this skill when you need a running RHDH instance to reproduce and fix a test failure.

## Prerequisites

Before running the deployment, verify these tools are installed:

```bash
# Required tools (local-run.sh checks these automatically)
podman --version        # Container runtime
oc version              # OpenShift CLI
kubectl version --client # Kubernetes CLI
vault --version         # HashiCorp Vault (for secrets)
jq --version            # JSON processor
curl --version          # HTTP client
rsync --version         # File sync
bc --version            # Calculator (for resource checks)
```

### Podman Machine Requirements

The podman machine must be running with adequate resources:

```bash
podman machine inspect | jq '.Resources'
# Requires: >= 8GB RAM, >= 4 CPUs
```

If resources are insufficient:
```bash
podman machine stop
podman machine set --memory 8192 --cpus 4
podman machine start
```

## Deployment Using local-run.sh

The primary deployment method uses `e2e-tests/local-run.sh`, which handles everything:
Vault authentication, cluster service account setup, RHDH deployment, and test execution.

### Execution Rules

**CRITICAL — deployment is a long-running operation:**

1. **Never run `local-run.sh` in the background.** Operator installations can take 20-30 minutes. Use the Bash tool with `timeout: 600000` (10 minutes) and if it times out, **check the container log** — do NOT assume failure.
2. **Before starting a deployment, check for existing containers:**
   ```bash
   podman ps --format "{{.Names}} {{.Status}}" | grep -i rhdh-e2e-runner
   ```
   If a deployment container is already running, **wait for it to finish** instead of starting a new one. Monitor via the container log:
   ```bash
   tail -f e2e-tests/.local-test/container.log
   ```
3. **Never launch concurrent deployments.** Two deployments to the same cluster will race and both fail. If a deployment appears stuck, check the container log and cluster state before deciding it failed.
4. **How to detect actual failure vs slow progress:** The operator install script outputs detailed debug logs. If the container log shows active progress (timestamps advancing), the deployment is still running. Only consider it failed if:
   - The podman container has exited (`podman ps` shows no running container)
   - AND the container log shows an error message (e.g., "Failed install RHDH Operator")

### CLI Mode (Preferred)

**CRITICAL**: CLI mode requires **all three** flags (`-j`, `-r`, `-t`). If `-r` is omitted, the script falls into interactive mode and will hang in automated contexts.

```bash
cd e2e-tests
./local-run.sh -j <full-prow-job-name> -r <image-repo> -t <image-tag> [-s]
```

**Example — OCP job** (deploy-only with `-s`):
```bash
cd e2e-tests
./local-run.sh -j periodic-ci-redhat-developer-rhdh-main-e2e-ocp-v4-20-helm-nightly -r rhdh-community/rhdh -t next -s
```

**Example — K8s job (AKS/EKS/GKE)** (full execution, no `-s`):
```bash
cd e2e-tests
./local-run.sh -j periodic-ci-redhat-developer-rhdh-main-e2e-eks-helm-nightly -r rhdh-community/rhdh -t next
```

**Parameters:**
- `-j / --job`: The **full Prow CI job name** extracted from the Prow URL. The `openshift-ci-tests.sh` handler uses bash glob patterns (like `*ocp*helm*nightly*`) to match, so the full name works correctly. Example: `periodic-ci-redhat-developer-rhdh-main-e2e-ocp-v4-20-helm-nightly`
- `-r / --repo`: Image repository (**required** for CLI mode — without it the script enters interactive mode)
- `-t / --tag`: Image tag (e.g., `1.9`, `next`)
- `-s / --skip-tests`: Deploy only, skip test execution. **OCP jobs only** — K8s jobs (AKS, EKS, GKE) do not support this flag and require the full execution pipeline

**WARNING**: Do NOT use shortened job names like `nightly-ocp-helm` for `-j` — these do not match the glob patterns in `openshift-ci-tests.sh`.

### Image Selection

Refer to the `e2e-fix-workflow` rule for the release branch to image repo/tag mapping table.

### Deploy-Only Mode (OCP Jobs Only)

For OCP jobs, deploy without running tests so you can run specific tests manually:

```bash
./local-run.sh -j <full-prow-job-name> -r <image-repo> -t <tag> -s
```

**Note**: K8s jobs (AKS, EKS, GKE) do not support deploy-only mode. They require the full execution pipeline — run without `-s`.

### What local-run.sh Does

1. **Validates prerequisites**: Checks all required tools and podman resources
2. **Verifies the image**: Checks the image exists on quay.io via the Quay API
3. **Pulls the runner image**: `quay.io/rhdh-community/rhdh-e2e-runner:main`
4. **Authenticates to Vault**: OIDC-based login for secrets
5. **Sets up cluster access**: Creates `rhdh-local-tester` service account with cluster-admin, generates 48h token
6. **Copies the repo**: Syncs the local repo to `.local-test/rhdh/` (excludes node_modules)
7. **Runs a Podman container**: Executes `container-init.sh` inside the runner image, which:
   - Fetches all Vault secrets to `/tmp/secrets/`
   - Logs into the cluster
   - Sets platform-specific environment variables
   - Runs `.ci/pipelines/openshift-ci-tests.sh` for deployment

### Post-Deployment: Setting Up for Manual Testing

After `local-run.sh` completes (with `-s` for OCP jobs, or after full execution for K8s jobs), set up the environment for headed Playwright testing:

```bash
# Source the test setup (choose 'showcase' or 'rbac')
source e2e-tests/local-test-setup.sh showcase
# or
source e2e-tests/local-test-setup.sh rbac
```

This exports:
- `BASE_URL` — The RHDH instance URL
- `K8S_CLUSTER_URL` — Cluster API server URL
- `K8S_CLUSTER_TOKEN` — Fresh service account token
- All Vault secrets as environment variables

Verify RHDH is accessible:
```bash
curl -sSk "$BASE_URL" -o /dev/null -w "%{http_code}"
# Should return 200
```

## Deployment Error Recovery

### Common Deployment Failures

#### CrashLoopBackOff

**Symptoms**: Pod repeatedly crashes and restarts.

**Investigation**:
```bash
# Check pod status
oc get pods -n <namespace>
# Check pod logs
oc logs -n <namespace> <pod-name> --previous
# Check events
oc get events -n <namespace> --sort-by=.lastTimestamp
```

**Common causes and fixes**:
1. **Missing ConfigMap**: The app-config ConfigMap wasn't created → check `.ci/pipelines/resources/config_map/` for the correct template
2. **Bad plugin configuration**: A dynamic plugin is misconfigured → check `dynamic-plugins-config` ConfigMap against `.ci/pipelines/resources/config_map/dynamic-plugins-config.yaml`
3. **Missing secrets**: Required secrets not mounted → verify secrets exist in the namespace
4. **Node.js errors**: Check for JavaScript errors in logs that indicate code issues

#### ImagePullBackOff

**Investigation**:
```bash
oc describe pod -n <namespace> <pod-name> | grep -A5 "Events"
```

**Common causes**:
1. **Image doesn't exist**: Verify on quay.io: `curl -s 'https://quay.io/api/v1/repository/rhdh/rhdh-hub-rhel9/tag/?filter_tag_name=like:<tag>'`
2. **Pull secret missing**: Check `namespace::setup_image_pull_secret` in `.ci/pipelines/lib/namespace.sh`
3. **Registry auth**: Ensure the pull secret has correct credentials

#### Helm Install Failure

**Investigation**:
```bash
helm list -n <namespace>
helm status <release-name> -n <namespace>
```

**Common causes**:
1. **Values file error**: Check merged values against `.ci/pipelines/value_files/values_showcase.yaml`
2. **Chart version mismatch**: Verify chart version with `helm::get_chart_version` from `.ci/pipelines/lib/helm.sh`

#### Operator Deployment Failure

**Investigation**:
```bash
oc get backstage -n <namespace>
oc describe backstage <name> -n <namespace>
oc get csv -n <namespace>  # Check operator subscription status
```

**Common causes**:
1. **Backstage CR misconfigured**: Compare against `.ci/pipelines/resources/rhdh-operator/rhdh-start.yaml`
2. **Operator not installed**: Check CatalogSource and Subscription
3. **CRD not ready**: Wait for CRD with `k8s_wait::crd` pattern from `.ci/pipelines/lib/k8s-wait.sh`

### Cross-Repo Investigation

When deployment issues stem from the operator or chart, search the relevant repos using whichever tool is available. Try them in this order and use the first one that works:

1. **Sourcebot** (if available): search `rhdh-operator` and `rhdh-chart` repos for specific error patterns or configuration keys
2. **Context7** (if available): query `redhat-developer/rhdh-operator` or `redhat-developer/rhdh-chart` for docs and code snippets
3. **Fallback — `gh search code`**: `gh search code '<pattern>' --repo redhat-developer/rhdh-operator` or `redhat-developer/rhdh-chart`
4. **Fallback — local clone**: clone the repo into a temp directory and grep for the pattern

Key areas to look for:
- **rhdh-operator**: Backstage CR configuration, CatalogSource setup, operator installation scripts
- **rhdh-chart**: Helm values schema, chart templates, default configurations

## Reference Files

- Main deployment scripts: `.ci/pipelines/openshift-ci-tests.sh`, `.ci/pipelines/utils.sh`
- Library scripts: `.ci/pipelines/lib/helm.sh`, `.ci/pipelines/lib/operators.sh`, `.ci/pipelines/lib/k8s-wait.sh`, `.ci/pipelines/lib/testing.sh`
- Helm values: `.ci/pipelines/value_files/`
- ConfigMaps: `.ci/pipelines/resources/config_map/`
- Operator CRs: `.ci/pipelines/resources/rhdh-operator/`
- Environment variables: `.ci/pipelines/env_variables.sh`
