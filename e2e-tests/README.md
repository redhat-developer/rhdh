# Readme for e2e tests

The readme for the e2e framework is located [here](../docs/e2e-tests/README.md)
The contribution guidelines are [here](../docs/e2e-tests/CONTRIBUTING.MD)
The example and bootstraps to create tests are [here](../docs/e2e-tests/examples.md)
Cloud SQL runtime prerequisites and entry points are [here](../docs/e2e-tests/cloudsql-runtime.md).

---

## Plugin Sanity Check (cluster-free)

Validates that every plugin enabled by the catalog index loads in the real RHDH
backend (booted from `packages/backend` source). Populate `dynamic-plugins-root`
with the full index set, then run the dedicated Playwright config:

```bash
CATALOG_INDEX_IMAGE=quay.io/rhdh/plugin-catalog-index:next \
  ./local-harness/populate-catalog-index.sh
yarn e2e:plugin-sanity
```

The spec lives in `playwright/cluster-free/`, outside the `testDir` the cluster
projects scan, so it needs no per-project `testIgnore`. Put further
cluster-free-only specs there too.

CI runs it as the `plugin-sanity` job of the
[E2E Cluster-free workflow](../.github/workflows/e2e-cluster-free.yaml) — nightly
(`cron: 0 5 * * *`) and on `workflow_dispatch`, not on pull requests. A PR in
this repo cannot change the catalog index, so running the job as a PR check only
fails unrelated work when the index drifts. The runner has no registry
credentials: digest-pinned packages resolve anonymously (the install CLI rewrites
`registry.access.redhat.com/rhdh/` to `quay.io/rhdh/`). The few packages that are
not published publicly are listed in `local-harness/plugin-sanity-excludes.txt`.

The index is built outside this repo and changes on its own — it grew from 9 to
36 declared packages in the space of a week. For RC verification, run the
workflow manually and set the `catalog_index_image` input.

This complements, but does not depend on, the cluster-based `sanity-plugins`
deployment in the nightly OCP job: that one validates the curated plugin set on
the shipped image, while this validates the full index composition against the
current backend line, with no cluster and no product image.

Plugins that cannot initialize in a standalone backend are excluded in
`local-harness/plugin-sanity-excludes.txt`, which documents the rules and the
reason for each entry. When a plugin does abort the backend, the job pulls the
culprits onto the run summary via
`local-harness/filter-plugin-startup-failures.sh`.

## Local Test Runner

This directory contains scripts to run e2e tests locally against an OpenShift cluster.

### Prerequisites

Before running, ensure you have:

1. **Podman** installed and running with at least **8GB RAM** and **4 CPUs**
2. **oc CLI** installed and logged into your OpenShift cluster (`oc login`)
3. **Bitwarden CLI** installed, with access to the `rhdh-qe` collection and an unlocked session — see [Managing E2E Secrets](../docs/e2e-tests/managing-e2e-secrets.md)
4. E2E dependencies installed with `yarn install`
5. **jq** installed (for JSON parsing)

#### Installing Prerequisites (macOS)

```bash
# Install tools via Homebrew
brew install podman jq rsync openshift-cli bitwarden-cli

# Setup Podman machine (first time only)
podman machine init --memory 8192 --cpus 4
podman machine start
```

#### Installing Prerequisites (Linux)

Install `podman`, `oc`, `kubectl`, `bw`, `jq`, `rsync`, and `curl` using your distribution's package manager.

Both local runners load secrets from Bitwarden. Authentication is covered by the
[upstream Secrets API documentation](https://redhat-developer.github.io/rhdh-e2e-test-utils/api/secrets.html#local-command).
Repository-specific secret names, failed checks, and the single-run lock are described in
[Managing E2E Secrets](../docs/e2e-tests/managing-e2e-secrets.md).

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

| Script              | Description                                                     |
| ------------------- | --------------------------------------------------------------- |
| `local-run.sh`      | Main script - deploys RHDH to cluster and optionally runs tests |
| `container-init.sh` | Runs inside the container (called by local-run.sh)              |
| `local-test.sh`     | Runs Playwright on the host against an existing deployment      |

### Quick Start

```bash
cd e2e-tests
./local-run.sh
```

Follow the interactive prompts to select:

1. **Run mode**: **1** = Deploy only (default, for headed debugging); **2** = Deploy and run tests
2. **Job type**: OCP Helm PR tests, Nightly tests, Operator tests, etc.
3. **Image type**:
   - **Downstream RHEL 9** (`quay.io/rhdh/rhdh-hub-rhel9`): `next`, `latest`, or release-specific tag (maintenance branches)
   - **Downstream RHEL 10** (`quay.io/rhdh/rhdh-hub-rhel10`): `next`, `latest`, or release-specific tag (`main` / 2.y stream)
   - **PR image** (`quay.io/rhdh-community/rhdh`): Enter PR number

After the container finishes, you're back on your host with the cluster still accessible.

### CLI Flags (Non-Interactive Mode)

For automation or quick runs, use CLI flags to skip interactive prompts:

```bash
# Deploy and test a PR image
./local-run.sh -j pull-ci-redhat-developer-rhdh-main-e2e-ocp-helm --pr 4023

# Deploy a PR image for host-side debugging
./local-run.sh -j pull-ci-redhat-developer-rhdh-main-e2e-ocp-helm --pr 4023 --skip-tests

# Deploy downstream next image
./local-run.sh --repo rhdh/rhdh-hub-rhel10 --tag next --skip-tests

# RHEL 9 maintenance stream image
./local-run.sh --repo rhdh/rhdh-hub-rhel9 --tag next --skip-tests

# Use a custom registry
./local-run.sh --registry registry.redhat.io --repo rhdh/rhdh-hub-rhel9 --tag latest --skip-tests

# Full flags
./local-run.sh -j pull-ci-redhat-developer-rhdh-main-e2e-ocp-helm -R registry.redhat.io -r rhdh/rhdh-hub-rhel9 -t next -s

# Disconnected Operator / Helm nightlies (requires a real OpenShift cluster)
./local-run.sh -j periodic-ci-redhat-developer-rhdh-main-e2e-ocp-disconnected-operator-nightly -r rhdh-community/rhdh -t next -s
./local-run.sh -j periodic-ci-redhat-developer-rhdh-main-e2e-ocp-disconnected-helm-nightly -r rhdh-community/rhdh -t next -s
```

#### Local disconnected OCP smokes

Disconnected Operator and Helm nightlies can be started only via `local-run.sh` against a **real running OpenShift cluster** (connected is fine; no bastion, kind, or mock registry). You must already be logged in with `oc` (cluster-admin or equivalent to expose the image registry and apply IDMS).

`local-run.sh` sets `DISCONNECTED=true` and `LOCAL_DISCONNECTED=1` for `*disconnected*` jobs. The e2e-runner bootstraps `MIRROR_*` **inside the container**, using the cluster image registry route: the public route CA goes under `${SHARED_DIR}/disconnected-mirror/` (worktree mount), and the merged registry pull secret stays in a private container-only temporary directory. Operator prepare uses `--to-registry OCP_INTERNAL`; Helm oc-mirrors to the exposed registry route. For air-gap prepare semantics, see [rhdh-operator](https://github.com/redhat-developer/rhdh-operator) docs — this path does not duplicate them.

| Flag                 | Description                                                                        |
| -------------------- | ---------------------------------------------------------------------------------- |
| `-j, --job`          | Job name                                                                           |
| `-R, --registry`     | Image registry (default: `quay.io`)                                                |
| `-r, --repo`         | Image repository (e.g., `rhdh/rhdh-hub-rhel10` or `rhdh/rhdh-hub-rhel9`)           |
| `-t, --tag`          | Image tag (e.g., `next`, `latest`, `1.5`)                                          |
| `-p, --pr`           | PR number (sets repo to `rhdh-community/rhdh`, tag to `pr-<number>`)               |
| `-i, --runner-image` | Override the runner image (default: `quay.io/rhdh-community/rhdh-e2e-runner:main`) |
| `-s, --skip-tests`   | Deploy only, skip running tests                                                    |
| `-h, --help`         | Show help message                                                                  |

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

#### Step 2: Run tests on the host

```bash
cd e2e-tests
yarn install

# Match these to the deployed namespaces.
export NAME_SPACE=showcase NAME_SPACE_RBAC=showcase-rbac

# The full showcase suites include cluster-aware tests. local-run.sh created this
# service account; request a fresh token using your current cluster login.
K8S_CLUSTER_URL="$(oc whoami --show-server)" && export K8S_CLUSTER_URL
K8S_CLUSTER_TOKEN="$(oc create token rhdh-local-tester -n rhdh-local-test --duration=8h)" && export K8S_CLUSTER_TOKEN

BASE_URL=https://your-showcase-url \
  ./local-test.sh -- --project=showcase --headed
```

`local-test.sh` requires the namespace variable of the selected project (`NAME_SPACE`,
`NAME_SPACE_RBAC`, or `NAME_SPACE_RUNTIME`). Run the setup above before the host examples
below, and use the URL of the deployment matching the selected project. For Kubernetes,
read the API server with `kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}'`
and request the token with `kubectl create token rhdh-local-tester -n rhdh-local-test --duration=8h`.
Both CLIs must target the cluster hosting the deployment. Authentication prerequisites
are linked from [Managing E2E Secrets](../docs/e2e-tests/managing-e2e-secrets.md#running-with-secrets).
`showcase-runtime` needs further caller-provided values on the host — see
[Running with Secrets](../docs/e2e-tests/managing-e2e-secrets.md#running-with-secrets).

#### Useful Playwright Commands

```bash
# Run all tests
BASE_URL=https://your-showcase-url ./local-test.sh -- --project=showcase --headed

# Run a specific test file (use --project to specify which project)
BASE_URL=https://your-showcase-url ./local-test.sh -- --project=showcase --headed playwright/e2e/guest-signin-happy-path.spec.ts

# Run RBAC tests against the RBAC deployment URL
BASE_URL=https://your-rbac-url ./local-test.sh -- --project=showcase-rbac --headed playwright/e2e/audit-log/auditor-rbac.spec.ts

# Run tests matching a pattern (by test name)
BASE_URL=https://your-showcase-url ./local-test.sh -- --project=showcase --headed -g "Verify Profile is Guest"
BASE_URL=https://your-rbac-url ./local-test.sh -- --project=showcase-rbac --headed -g "role-read"

# Run with trace for debugging
BASE_URL=https://your-showcase-url ./local-test.sh -- --project=showcase --headed --trace on

# Run in UI mode (interactive debugging with time-travel)
BASE_URL=https://your-showcase-url ./local-test.sh -- --project=showcase --ui

# View the last host test report
npx playwright show-report playwright-report
```

> **Tip:** UI mode (`--ui`) opens an interactive browser where you can:
>
> - See all tests and run them individually
> - Watch tests execute in real-time
> - Step through test actions with time-travel debugging
> - Inspect DOM snapshots at each step
> - View console logs and network requests

### Reproducing the OCP Helm PR Check on the Host

After the deployment and host connection setup above, run both projects sequentially
against their respective URLs. `CI=true` selects the worker count and retries configured
in `playwright.config.ts` (three workers and two retries by default, with project-specific
overrides). The job and platform variables reproduce the OCP Helm PR check's test selection
and installation-method detection.

```bash
export JOB_NAME=pull-ci-redhat-developer-rhdh-main-e2e-ocp-helm
export IS_OPENSHIFT=true CONTAINER_PLATFORM=ocp

CI=true BASE_URL=https://your-showcase-url \
  ./local-test.sh -- --project=showcase

CI=true BASE_URL=https://your-rbac-url \
  ./local-test.sh -- --project=showcase-rbac
```

For first-attempt failure investigation, add `--retries=0`. To run a single test with
one worker and a visible browser, use an existing spec and a matching test name:

```bash
BASE_URL=https://your-showcase-url ./local-test.sh -- \
  --project=showcase --no-deps --workers=1 --retries=0 --headed \
  playwright/e2e/guest-signin-happy-path.spec.ts -g "Verify Profile is Guest"
```

`./local-run.sh -j "$JOB_NAME" --pr 4023` runs the complete deployment and both projects
in the runner container, including CI environment setup and artifact collection.

---

### Test tags

Specs declare `@tag` markers via Playwright's native
[test tags](https://playwright.dev/docs/test-annotations#tag-tests) — the `tag`
option on `test` / `test.describe` (e.g.
`test.describe("Smoke test", { tag: "@smoke" }, () => { ... })`). This keeps the
tag out of the test title, so names stay stable for historical reporting while
Playwright's `--grep` / `--grep-invert` filters still select tests by tag,
letting CI or a local run target a subset.

| Tag                     | Meaning                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `@layer3-equivalent`    | A UI behavior in this spec also has a sibling Layer 3 component test (in `packages/app`). |
| `@smoke`                | Fast, high-signal check suitable to run on every PR.                                      |
| `@ga-plugin`            | Exercises a generally-available (GA) plugin.                                              |
| `@non-ga-plugin`        | Exercises a tech-preview / dev-preview (non-GA) plugin.                                   |
| `@blocked`              | Blocked by a known issue; tests are skipped with a Jira reference.                        |
| `@cluster-free-capable` | Validated to also run on the cluster-free harness.                                        |

`@cluster-free-capable` is what `playwright.local.config.ts` selects on. It
describes a capability of the test, not how a given run executed: the tag still shows
in reports of cluster runs, where the project name (e.g. `showcase-sanity-plugins`) is
what identifies the execution mode.

```bash
# Run only smoke-tagged tests
BASE_URL=https://your-showcase-url ./local-test.sh -- --project=showcase --grep "@smoke"

# Run everything except specs that already have a Layer 3 equivalent
BASE_URL=https://your-showcase-url ./local-test.sh -- --project=showcase --grep-invert "@layer3-equivalent"
```

In CI, set the `PLAYWRIGHT_GREP` environment variable (consumed by
`.ci/pipelines/lib/testing.sh`) to apply the same filter to a job, e.g.
`PLAYWRIGHT_GREP='@smoke'`.

> **Note:** `@layer3-equivalent` marks overlap with Layer 3 coverage; it does
> not remove the E2E spec. Whether to retire any duplicated E2E coverage is a
> separate decision tracked elsewhere.

---

### Configuration Options

#### Job Types

Log in to the target OpenShift cluster with `oc login`, or configure your Kubernetes
kubeconfig so `kubectl cluster-info` reaches the target cluster.

| Option | JOB_NAME Pattern                        | Description                             |
| ------ | --------------------------------------- | --------------------------------------- |
| 1      | `*pull*ocp*helm*`                       | OCP Helm PR tests                       |
| 2      | `*ocp*helm*nightly*`                    | OCP Helm Nightly tests                  |
| 3      | `*ocp*operator*nightly*`                | OCP Operator Nightly tests              |
| 4      | `*ocp*helm*upgrade*nightly*`            | OCP Helm Upgrade tests                  |
| 5      | `*ocp*operator*auth-providers*nightly*` | Auth Providers tests                    |
| 6      | `*aks*helm*nightly*`                    | AKS Helm Nightly tests                  |
| 7      | `*eks*helm*nightly*`                    | EKS Helm Nightly tests                  |
| 8      | `*gke*helm*nightly*`                    | GKE Helm Nightly tests                  |
| 9      | `*ocp*disconnected*operator*nightly*`   | Disconnected OCP Operator Nightly tests |
| 10     | `*ocp*disconnected*helm*nightly*`       | Disconnected OCP Helm Nightly tests     |
| 11     | Custom                                  | Enter the full Prow JOB_NAME            |

**Other supported patterns** (use Custom option):

- `*aks*helm*nightly*` / `*aks*operator*nightly*` - Azure AKS
- `*eks*helm*nightly*` / `*eks*operator*nightly*` - AWS EKS
- `*gke*helm*nightly*` / `*gke*operator*nightly*` - Google GKE
- `*osd-gcp*helm*nightly*` / `*osd-gcp*operator*nightly*` - OSD GCP

#### Image Types

| Option | Repository                                | Description                           |
| ------ | ----------------------------------------- | ------------------------------------- |
| 1      | `quay.io/rhdh/rhdh-hub-rhel9`             | Downstream RHEL 9 image               |
| 2      | `quay.io/rhdh/rhdh-hub-rhel10`            | Downstream RHEL 10 image (default)    |
| 3      | `quay.io/rhdh-community/rhdh`             | PR image; enter a PR number           |
| 4      | `registry.redhat.io/rhdh/rhdh-hub-rhel9`  | Released RHEL 9 image                 |
| 5      | `registry.redhat.io/rhdh/rhdh-hub-rhel10` | Released RHEL 10 image                |
| 6      | Custom                                    | Enter a registry, repository, and tag |

#### Downstream Image Tags

Downstream image types 1 and 2 offer these tag choices. PR image type 3 derives
`pr-<number>` from the PR number; released and custom types prompt for the tag directly.

| Option | Tag         | Description                        |
| ------ | ----------- | ---------------------------------- |
| 1      | `next`      | Latest development build (default) |
| 2      | `latest`    | Latest stable release              |
| 3      | Release tag | Enter a release-specific tag       |

### Examples

Host examples use the [namespace and cluster-token setup above](#running-tests-locally-in-headed-mode-recommended-for-debugging).

#### Example 1: Test a PR image

Test changes from PR #4020 using the community image:

```bash
cd e2e-tests
./local-run.sh

# Select:
#   Run: 2 (Deploy and run tests)
#   Job: 1 (OCP Helm PR tests)
#   Image type: 3 (PR image) → Enter PR number: 4020
```

#### Example 2: Deploy only, debug tests locally

Deploy and then run specific tests in headed mode:

```bash
cd e2e-tests
./local-run.sh

# Select:
#   Run: 1 (Deploy only)
#   Job: 1 (OCP Helm PR tests)
#   Image type: 2 (Downstream RHEL 10)
#   Tag: 1 (next)

# Use the URL printed by local-run.sh:
BASE_URL=https://your-showcase-url \
  ./local-test.sh -- --project=showcase --headed -g "Verify Profile is Guest"
```

#### Example 3: Test Red Hat image with nightly job

Test the official Red Hat image:

```bash
cd e2e-tests
./local-run.sh

# Select:
#   Run: 2 (Deploy and run tests)
#   Job: 2 (OCP Helm Nightly)
#   Image type: 2 (Downstream RHEL 10)
#   Tag: 1 (next)
```

#### Example 4: Test RBAC functionality locally

Deploy and run RBAC tests in headed mode:

```bash
cd e2e-tests
./local-run.sh
# Select: Deploy only

# Use the RBAC URL printed by local-run.sh:
BASE_URL=https://your-rbac-url \
  ./local-test.sh -- --project=showcase-rbac --headed
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
#   Run: 2 (Deploy and run tests)
#   Job: 6 (AKS Helm Nightly), 7 (EKS Helm Nightly), or 8 (GKE Helm Nightly)
#   Image type: 2 (Downstream RHEL 10)
#   Tag: 1 (next)
```

#### Example 6: Run a single test file

```bash
cd e2e-tests
yarn install
BASE_URL=https://your-showcase-url ./local-test.sh -- --project=showcase --headed \
  playwright/e2e/guest-signin-happy-path.spec.ts
```

#### Example 7: Run tests with trace for debugging

```bash
cd e2e-tests
BASE_URL=https://your-showcase-url ./local-test.sh -- \
  --project=showcase --headed --trace on -g "Catalog"
```

#### Example 8: Interactive debugging with UI mode

```bash
cd e2e-tests
BASE_URL=https://your-showcase-url ./local-test.sh -- --project=showcase --ui
```

This opens an interactive UI where you can select individual tests, watch them run in real-time, and step through actions with time-travel debugging.

### How It Works

1. **local-run.sh**:
   - Pulls the e2e-runner container image
   - Uses `rhdh-e2e-secrets` to select secrets from Bitwarden
   - Creates a service account on the cluster with cluster-admin role
   - Copies repo to `e2e-tests/.local-test/rhdh` (keeps original clean)
   - Streams selected Bitwarden values through an inherited file descriptor; values are materialized only in the container's private tmpfs

2. **container-init.sh** (inside container):
   - Reads and validates the secret stream from stdin into a private `/tmp/secrets` tmpfs
   - Uses the original CI file-based secret assignments and aliases in `env_variables.sh`
   - Logs into OpenShift cluster
   - Sets up environment variables
   - Runs deployment via `openshift-ci-tests.sh`
   - If tests are skipped, outputs URLs and saves config

3. **local-test.sh** (for host-side tests):
   - Requires the caller to set `BASE_URL` and choose a Playwright project
   - Uses the same Bitwarden profile as `local-run.sh`
   - Passes FD 3 to `local-test-secrets.ts`, which uses the installed package's stream decoder
   - Prepares the test child environment and file-backed certificates without sourcing CI setup
   - Runs Playwright directly from `e2e-tests/`
   - Preserves caller-supplied `K8S_CLUSTER_URL` and `K8S_CLUSTER_TOKEN`
   - Does not deploy RHDH, read `config.env`, generate tokens, or write `.env`

### Environment Variables

Set the required connection variables before invoking `local-test.sh`. Treat `BW_SESSION` and
`K8S_CLUSTER_TOKEN` as secrets and never persist them in files:

Host tests target an existing deployment, so set its namespace explicitly. For the
default deployments created by `local-run.sh`:

```bash
export NAME_SPACE=showcase
export NAME_SPACE_RBAC=showcase-rbac
export NAME_SPACE_RUNTIME=showcase-runtime
```

The wrapper validates the corresponding namespace for `showcase`, `showcase-k8s`,
`showcase-operator`, their RBAC variants, and `showcase-runtime`, including project
glob patterns. Caller-supplied namespaces take precedence over profile values.
Host and container runs both download the current public AWS RDS CA bundle; a failed
download leaves no certificate file and never falls back to a stored RDS bundle.

| Variable               | Description                                                                   |
| ---------------------- | ----------------------------------------------------------------------------- |
| `BASE_URL`             | URL of the deployed RHDH instance (Playwright uses this as the test base URL) |
| `K8S_CLUSTER_URL`      | Cluster API server URL; required only by cluster-aware tests                  |
| `K8S_CLUSTER_TOKEN`    | Existing cluster token; required only by cluster-aware tests                  |
| `NAME_SPACE`           | Deployed namespace for standard showcase projects                             |
| `NAME_SPACE_RBAC`      | Deployed namespace for RBAC showcase projects                                 |
| `NAME_SPACE_RUNTIME`   | Deployed namespace for the runtime project                                    |
| `BW_SESSION`           | Unlocked Bitwarden session used only while loading secrets                    |
| `RHDH_E2E_SECRETS_BIN` | Optional path or command override for `rhdh-e2e-secrets`                      |

> **Note:** `BASE_URL` is the canonical Playwright base URL for the RHDH instance under test.
> `local-test.sh` does not infer `BASE_URL` from deployment state. Use the standard or RBAC URL
> printed by the deployment, according to the selected Playwright project.
> Yarn scripts such as `yarn showcase`, `yarn showcase-rbac`, and `yarn test:stability` still use
> the `showcase` Playwright project name for historical reasons.

### Artifacts and Logs

Container test artifacts are saved to `e2e-tests/.local-test/rhdh/.local-test/`:

- `artifact_dir/` - Test artifacts, screenshots, traces
- `shared_dir/` - Shared data between test runs
- `config.env` - Deployment configuration retained for deployment troubleshooting

Host runs use `e2e-tests/playwright-report/` for the HTML report,
`e2e-tests/test-results/` for screenshots and traces, and `e2e-tests/junit-results.xml`
for JUnit results by default. Each host invocation replaces its previous report;
run the projects sequentially and save reports you want to retain before starting another run.

From `e2e-tests`, open the appropriate report:

```bash
# Latest host run
npx playwright show-report playwright-report

# Container OCP Helm PR-check runs
npx playwright show-report .local-test/rhdh/.local-test/artifact_dir/showcase
npx playwright show-report .local-test/rhdh/.local-test/artifact_dir/showcase-rbac
```

### Cancelling a Local Run

Press Ctrl+C or send SIGTERM to `local-run.sh` to stop the runner. Podman's init process
forwards termination to the container's processes. The wrapper drains its log and holds
the checkout lock until the runner exits, then removes the lock. Ctrl+C exits with code
130; SIGTERM exits with code 143.

### Troubleshooting

#### Error: Script failed

Check `e2e-tests/.local-test/container.log` and the container artifacts above for the
failing step. The runner exits with the failure code and removes its container.

#### Error: Not logged into OpenShift

Run `oc login` before `local-run.sh`. For cluster-aware host tests, explicitly set
`K8S_CLUSTER_URL` and `K8S_CLUSTER_TOKEN` when running `local-test.sh`.

#### Error: BW_SESSION is required

Unlock Bitwarden and export the returned session; see
[Early Bitwarden Checks and Recovery](../docs/e2e-tests/managing-e2e-secrets.md#early-bitwarden-checks-and-recovery).

#### Error: Image does not exist

The script verifies the image exists on quay.io before proceeding (verification is skipped for non-quay registries). For PR images, ensure the PR build has completed.

### Security Notes

- Selected Bitwarden values cross the host/container boundary through FD 3, rather than command arguments or exported environment values. The container provides individual files at CI's existing `/tmp/secrets` path.
- Container secrets are materialized with restrictive permissions in a private tmpfs; host-side secret and certificate files are removed after tests. Runtime secret storage is kept outside shared state and public artifacts.
- Invalid streams and conflicting certificate aliases fail preparation before tests start. The host adapter preserves caller connection values and namespaces, excludes profile-supplied process controls, and keeps `EPHEMERAL_CLUSTER_ADMIN_*` values out of the test environment. Cluster-login reads only its two explicit credentials.
- Shell tracing is off by default; the host adapter handles values as data in the test child environment. Do not enable tracing for secret-bearing commands or dump the test environment.
- `local-test.sh` never generates or stores `K8S_CLUSTER_TOKEN`
- The repo is copied to `e2e-tests/.local-test/rhdh` so the original stays clean
- Service account tokens have an 8-hour duration

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

An agent skill is available at `.agents/skills/trigger-nightly-job/SKILL.md` that provides an interactive, AI-guided workflow for triggering nightly jobs. It:

- Fetches available jobs from Prow and presents them in a table
- Maps natural language descriptions to job names (e.g., "ocp helm" or "azure operator")
- Checks for shared cluster constraints (GKE and OSD-GCP jobs share clusters)
- Fetches available image tags from Quay when needed
- Builds the command and asks for confirmation before executing

To use it, invoke the `trigger-nightly-job` skill in your agent.

### Available Job Names

The full list of configured nightly jobs is at: https://prow.ci.openshift.org/configured-jobs/redhat-developer/rhdh

Job name pattern: `periodic-ci-redhat-developer-rhdh-{BRANCH}-e2e-{PLATFORM}-{METHOD}-nightly`
