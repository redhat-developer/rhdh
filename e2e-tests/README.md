# Readme for e2e tests

The readme for the e2e framework is located [here](../docs/e2e-tests/README.md)
The contribution guidelines are [here](../docs/e2e-tests/CONTRIBUTING.MD)
The example and bootstraps to create tests are [here](../docs/e2e-tests/examples.md)

---

## Local Test Runner

This directory contains scripts to run e2e tests locally against an OpenShift cluster.

### Prerequisites

Before running, ensure you have:

1. **Podman** installed and running with at least **8GB RAM** and **4 CPUs**
2. **oc CLI** installed and logged into your OpenShift cluster (`oc login`)
3. **Vault CLI** installed (for fetching secrets)
4. **jq** installed (for JSON parsing)
5. Access to the OpenShift CI vault (`https://vault.ci.openshift.org/ui/vault/secrets/kv/list/selfservice/rhdh-qe/`) - if you don't have access, reach out to @rhdh-qe in the team-rhdh channel.

#### Installing Prerequisites (macOS)

```bash
# Install tools via Homebrew
brew install podman jq rsync openshift-cli

# Install HashiCorp Vault (requires tap)
brew tap hashicorp/tap
brew install hashicorp/tap/vault

# Setup Podman machine (first time only)
podman machine init --memory 8192 --cpus 4
podman machine start
```

### Getting a Cluster

You need an OpenShift cluster to run e2e tests. Here are your options:

#### Option 1: Cluster Bot (Recommended)

Use the cluster-bot Slack app to request an ephemeral cluster. Send a direct message to the `cluster-bot` app:

```
launch 4.18 aws
```

The bot will provide login credentials once the cluster is ready (usually within a few minutes).

#### Option 2: rhdh-test-instance

You can use the [rhdh-test-instance](https://github.com/redhat-developer/rhdh-test-instance) to get an ephemeral cluster.

> **⚠️ Warning:** This option is **not recommended for frequent testing** as it may interfere with existing PR test runs due to cluster claim conflicts. Use occasionally or for one-off testing only.

See the [rhdh-test-instance README](https://github.com/redhat-developer/rhdh-test-instance/blob/main/README.md) for usage instructions.

#### Option 3: Bring Your Own Cluster

Use any OpenShift cluster you have access to. Simply login with `oc login` before running the local test runner.

### Scripts

| Script                | Description                                                     |
| --------------------- | --------------------------------------------------------------- |
| `local-run.sh`        | Main script - deploys RHDH to cluster and optionally runs tests |
| `container-init.sh`   | Runs inside the container (called by local-run.sh)              |
| `local-test-setup.sh` | Sets up environment for running tests locally in headed mode    |

### Quick Start

```bash
cd e2e-tests
./local-run.sh
```

Follow the interactive prompts to select:

1. **Run mode**: Deploy only (default, for headed debugging) or Deploy and run tests
2. **Job type**: OCP Helm PR tests, Nightly tests, Operator tests, etc.
3. **Image type**:
   - **Downstream** (`quay.io/rhdh/rhdh-hub-rhel9`): `next`, `latest`, or release-specific tag
   - **PR image** (`quay.io/rhdh-community/rhdh`): Enter PR number

After the container finishes, you're back on your host with the cluster still accessible.

### CLI Flags (Non-Interactive Mode)

For automation or quick runs, use CLI flags to skip interactive prompts:

```bash
# Test a PR image
./local-run.sh --pr 4023 --skip-tests

# Deploy downstream next image
./local-run.sh --repo rhdh/rhdh-hub-rhel9 --tag next --skip-tests

# Use a custom registry
./local-run.sh --registry registry.redhat.io --repo rhdh/rhdh-hub-rhel9 --tag latest --skip-tests

# Full flags
./local-run.sh -j pull-ci-redhat-developer-rhdh-main-e2e-ocp-helm -R registry.redhat.io -r rhdh/rhdh-hub-rhel9 -t next -s
```

| Flag               | Description                                                          |
| ------------------ | -------------------------------------------------------------------- |
| `-j, --job`        | Job name                                                             |
| `-R, --registry`   | Image registry (default: `quay.io`)                                  |
| `-r, --repo`       | Image repository (e.g., `rhdh/rhdh-hub-rhel9`)                       |
| `-t, --tag`        | Image tag (e.g., `next`, `latest`, `1.5`)                            |
| `-p, --pr`         | PR number (sets repo to `rhdh-community/rhdh`, tag to `pr-<number>`) |
| `-s, --skip-tests` | Deploy only, skip running tests                                      |
| `-h, --help`       | Show help message                                                    |

---

### Running Tests Locally in Headed Mode (Recommended for Debugging)

> **This is the recommended approach for debugging tests** - you can see the browser UI, step through tests, and interact with the application.

#### Step 1: Deploy RHDH to the cluster

```bash
cd e2e-tests
./local-run.sh
# Select "Deploy only" (the default option)
```

The container will deploy RHDH and exit. You'll see next steps printed in the terminal.

#### Step 2: Setup environment

```bash
cd e2e-tests
source local-test-setup.sh           # For Showcase tests
# or: source local-test-setup.sh rbac  # For RBAC tests
```

#### Step 3: Run tests with visible browser

```bash
yarn install
yarn playwright test --headed
```

#### Useful Playwright Commands

```bash
# Run all tests
yarn playwright test --headed

# Run a specific test file (use --project to specify which project)
yarn playwright test playwright/e2e/plugins/quick-access-and-tech-radar.spec.ts --headed --project=showcase

# Run RBAC tests (requires RBAC URL - use: source local-test-setup.sh rbac)
yarn playwright test playwright/e2e/plugins/rbac/rbac.spec.ts --headed --project=showcase-rbac

# Run tests matching a pattern (by test name)
yarn playwright test --headed -g "guest user"
yarn playwright test --headed -g "catalog"

# Run with trace for debugging
yarn playwright test --headed --trace on

# Run in UI mode (interactive debugging with time-travel)
yarn playwright test --ui

# View the last test report
npx playwright show-report .local-test/rhdh/.local-test/artifact_dir/showcase
```

> **Tip:** UI mode (`--ui`) opens an interactive browser where you can:
>
> - See all tests and run them individually
> - Watch tests execute in real-time
> - Step through test actions with time-travel debugging
> - Inspect DOM snapshots at each step
> - View console logs and network requests

---

### Configuration Options

#### Job Types

All job types are supported as long as you're logged into the target cluster (`oc login` or `kubectl login`).

| Option | JOB_NAME Pattern                        | Description                |
| ------ | --------------------------------------- | -------------------------- |
| 1      | `*pull*ocp*helm*`                       | OCP Helm PR tests          |
| 2      | `*ocp*helm*nightly*`                    | OCP Helm Nightly tests     |
| 3      | `*ocp*operator*nightly*`                | OCP Operator Nightly tests |
| 4      | `*ocp*helm*upgrade*nightly*`            | OCP Helm Upgrade tests     |
| 5      | `*ocp*operator*auth-providers*nightly*` | Auth Providers tests       |
| 6      | Custom                                  | Enter your own JOB_NAME    |

**Other supported patterns** (use Custom option):

- `*aks*helm*nightly*` / `*aks*operator*nightly*` - Azure AKS
- `*eks*helm*nightly*` / `*eks*operator*nightly*` - AWS EKS
- `*gke*helm*nightly*` / `*gke*operator*nightly*` - Google GKE
- `*osd-gcp*helm*nightly*` / `*osd-gcp*operator*nightly*` - OSD GCP

#### Image Repositories

| Option | Repository            | Description               |
| ------ | --------------------- | ------------------------- |
| 1      | `rhdh-community/rhdh` | Community image (default) |
| 2      | `rhdh/rhdh-hub-rhel9` | Red Hat official image    |
| 3      | Custom                | Enter your own repository |

#### Image Tags

| Option | Tag           | Description                         |
| ------ | ------------- | ----------------------------------- |
| 1      | `next`        | Latest development build (default)  |
| 2      | `latest`      | Latest stable release               |
| 3      | `pr-<number>` | PR-specific build (e.g., `pr-4020`) |
| 4      | Custom        | Enter your own tag                  |

### Examples

#### Example 1: Test a PR image

Test changes from PR #4020 using the community image:

```bash
cd e2e-tests
./local-run.sh

# Select:
#   Job: 1 (OCP Helm PR tests)
#   Repo: 1 (rhdh-community/rhdh)
#   Tag: 3 (PR image) → Enter: 4020
#   Run: 1 (Deploy and run tests)
```

#### Example 2: Deploy only, debug tests locally

Deploy and then run specific tests in headed mode:

```bash
cd e2e-tests
./local-run.sh

# Select:
#   Job: 1 (OCP Helm PR tests)
#   Repo: 1 (rhdh-community/rhdh)
#   Tag: 1 (next)
#   Run: 2 (Deploy only)

# Keep container running, open new terminal:
cd e2e-tests
source local-test-setup.sh
yarn install
yarn playwright test --headed -g "guest user"
```

#### Example 3: Test Red Hat image with nightly job

Test the official Red Hat image:

```bash
cd e2e-tests
./local-run.sh

# Select:
#   Job: 2 (OCP Helm Nightly)
#   Repo: 2 (rhdh/rhdh-hub-rhel9)
#   Tag: 1 (next)
#   Run: 1 (Deploy and run tests)
```

#### Example 4: Test RBAC functionality locally

Deploy and run RBAC tests in headed mode:

```bash
cd e2e-tests
./local-run.sh
# Select: Deploy only

# New terminal:
cd e2e-tests
source local-test-setup.sh rbac    # Use RBAC URL
yarn install
yarn playwright test --headed --project=showcase-rbac
```

#### Example 5: Test on AKS/EKS/GKE cluster

First login to your cluster, then run:

```bash
# Login to your cluster
az aks get-credentials --resource-group myRG --name myAKS
# or: aws eks update-kubeconfig --name myEKS
# or: gcloud container clusters get-credentials myGKE

cd e2e-tests
./local-run.sh

# Select:
#   Job: 6 (Custom) → Enter: periodic-ci-aks-helm-nightly
#   Repo: 1 (rhdh-community/rhdh)
#   Tag: 1 (next)
#   Run: 1 (Deploy and run tests)
```

#### Example 6: Run a single test file

```bash
cd e2e-tests
source local-test-setup.sh
yarn install
yarn playwright test playwright/e2e/plugins/quick-access-and-tech-radar.spec.ts --headed --project=showcase
```

#### Example 7: Run tests with trace for debugging

```bash
cd e2e-tests
source local-test-setup.sh
yarn install
yarn playwright test --headed --trace on -g "catalog"
```

#### Example 8: Interactive debugging with UI mode

```bash
cd e2e-tests
source local-test-setup.sh
yarn install
yarn playwright test --ui
```

This opens an interactive UI where you can select individual tests, watch them run in real-time, and step through actions with time-travel debugging.

### How It Works

1. **local-run.sh**:
   - Pulls the e2e-runner container image
   - Logs into Vault (OIDC) and gets secrets token
   - Creates a service account on the cluster with cluster-admin role
   - Copies repo to `e2e-tests/.local-test/rhdh` (keeps original clean)
   - Runs container with all credentials

2. **container-init.sh** (inside container):
   - Installs Vault CLI if needed
   - Fetches secrets from Vault and writes to `/tmp/secrets/`
   - Logs into OpenShift cluster
   - Sets up environment variables
   - Runs deployment via `openshift-ci-tests.sh`
   - If tests are skipped, outputs URLs and saves config

3. **local-test-setup.sh** (for headed tests):
   - Reads config from `e2e-tests/.local-test/rhdh/.local-test/config.env`
   - Exports secrets as environment variables (not stored on disk)
   - Gets fresh K8S_CLUSTER_TOKEN from cluster
   - Sets BASE_URL for Playwright

### Environment Variables

After running `local-test-setup.sh`, these variables are set:

| Variable                    | Description                                   |
| --------------------------- | --------------------------------------------- |
| `BASE_URL`                  | URL of the deployed RHDH instance             |
| `SHOWCASE_URL`              | Showcase deployment URL                       |
| `SHOWCASE_RBAC_URL`         | Showcase RBAC deployment URL                  |
| `K8S_CLUSTER_URL`           | OpenShift API server URL                      |
| `K8S_CLUSTER_TOKEN`         | Service account token (48-hour duration)      |
| `JOB_NAME`                  | Selected job name                             |
| `IMAGE_REGISTRY`            | Image registry (default: `quay.io`)           |
| `IMAGE_REPO`                | Image repository (fallback: `QUAY_REPO`)      |
| `TAG_NAME`                  | Image tag                                     |
| Plus all secrets from Vault | (exported with `-`, `.`, `/` replaced by `_`) |

### Artifacts and Logs

Test artifacts are saved to `e2e-tests/.local-test/rhdh/.local-test/`:

- `artifact_dir/` - Test artifacts, screenshots, traces
- `shared_dir/` - Shared data between test runs
- `config.env` - Configuration for local-test-setup.sh

### Troubleshooting

#### Error: Script failed

The container will drop into an interactive shell for debugging. Check logs, run commands, and investigate.

#### Error: Config file not found

Run `./local-run.sh` first with "Deploy only" option to create the config.

#### Error: Not logged into OpenShift

Run `oc login` before running local-test-setup.sh.

#### Error: Image does not exist

The script verifies the image exists on quay.io before proceeding (verification is skipped for non-quay registries). For PR images, ensure the PR build has completed.

### Security Notes

- Secrets are fetched from Vault and exported as environment variables at runtime (not stored in files locally)
- K8S_CLUSTER_TOKEN is generated fresh each time (not stored)
- The repo is copied to `e2e-tests/.local-test/rhdh` so the original stays clean
- Service account tokens have a 48-hour duration

---

## Triggering Nightly CI Jobs

The script at `.ci/pipelines/trigger-nightly-job.sh` triggers RHDH nightly ProwJobs via the OpenShift CI Gangway REST API.

### Prerequisites

- `oc` CLI installed
- `curl` and `jq` installed
- Access to the OpenShift CI cluster (SSO login via browser)

### Usage

```bash
# Basic trigger (default image):
.ci/pipelines/trigger-nightly-job.sh --job periodic-ci-redhat-developer-rhdh-main-e2e-ocp-helm-nightly

# Trigger with a specific image:
.ci/pipelines/trigger-nightly-job.sh \
  --job periodic-ci-redhat-developer-rhdh-main-e2e-ocp-helm-nightly \
  --image-registry registry.redhat.io \
  --image-repo rhdh/rhdh-hub-rhel9 \
  --tag 1.9-123

# Dry-run (print the curl command without executing):
.ci/pipelines/trigger-nightly-job.sh \
  --job periodic-ci-redhat-developer-rhdh-main-e2e-ocp-helm-nightly \
  --dry-run
```

### Flags

| Flag                   | Description                                           |
| ---------------------- | ----------------------------------------------------- |
| `-j, --job`            | **(required)** Full ProwJob name to trigger           |
| `-I, --image-registry` | Override the image registry (default: `quay.io`)      |
| `-q, --image-repo`     | Override the image repository (requires `--tag`)      |
| `-t, --tag`            | Override the image tag                                |
| `-o, --org`            | Override the GitHub org (default: `redhat-developer`) |
| `-r, --repo`           | Override the GitHub repo name (default: `rhdh`)       |
| `-b, --branch`         | Override the branch name                              |
| `-S, --send-alerts`    | Send Slack alerts (default: alerts are skipped)       |
| `-n, --dry-run`        | Print the curl command without executing              |

### Authentication

The script uses a dedicated kubeconfig (`~/.config/openshift-ci/kubeconfig`) to avoid interfering with the current cluster context. If not logged in or the token is expired, it opens a browser for SSO login.

### AI-Assisted Triggering

A Claude Code command is available at `.claude/commands/trigger-nightly-job.md` that provides an interactive, AI-guided workflow for triggering nightly jobs. It:

- Fetches available jobs from Prow and presents them in a table
- Maps natural language descriptions to job names (e.g., "ocp helm" or "azure operator")
- Checks for shared cluster constraints (GKE and OSD-GCP jobs share clusters)
- Fetches available image tags from Quay when needed
- Builds the command and asks for confirmation before executing

To use it, run the `/trigger-nightly-job` command in Claude Code or OpenCode.

### Available Job Names

The full list of configured nightly jobs is at: https://prow.ci.openshift.org/configured-jobs/redhat-developer/rhdh

Job name pattern: `periodic-ci-redhat-developer-rhdh-{BRANCH}-e2e-{PLATFORM}-{METHOD}-nightly`
