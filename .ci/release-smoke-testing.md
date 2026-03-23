# Release Smoke Testing Process

This document describes how to run the existing CI test suite against a productized (Red Hat) RHDH image to validate a new release candidate before shipping.

The approach is simple: create a PR that overrides the community image references with the productized image, and let CI do the rest.

**Reference PR:** <https://github.com/redhat-developer/rhdh/pull/4431>

## Step 1: Override Variables in `openshift-ci-tests.sh`

Edit `.ci/pipelines/openshift-ci-tests.sh` and add the following exports **before** the `main()` function:

```bash
export CHART_VERSION="1.9-211-CI"
export HELM_CHART_URL="oci://quay.io/rhdh/chart"
export QUAY_REPO="rhdh/rhdh-hub-rhel9"
export TAG_NAME="1.9-211"
```

Replace the version and build numbers to match the release candidate you are testing.

- `CHART_VERSION` — Helm chart version to install (append `-CI` suffix).
- `HELM_CHART_URL` — OCI registry URL for the Helm chart.
- `QUAY_REPO` — Productized image repository (instead of the community `rhdh-community/rhdh`).
- `TAG_NAME` — Image tag for the release candidate.

## Step 2: Override Image in `values_showcase.yaml`

Edit `.ci/pipelines/value_files/values_showcase.yaml` and update the `upstream.backstage.image` section:

```yaml
upstream:
  backstage:
    image:
      pullPolicy: Always
      registry: quay.io
      repository: rhdh/rhdh-hub-rhel9   # was: rhdh-community/rhdh
      tag: "1.9-211"                     # was: next-1.9
```

## Step 3: Override Image in `values_showcase-rbac.yaml`

Apply the same image changes in `.ci/pipelines/value_files/values_showcase-rbac.yaml`:

```yaml
upstream:
  backstage:
    image:
      pullPolicy: Always
      registry: quay.io
      repository: rhdh/rhdh-hub-rhel9   # was: rhdh-community/rhdh
      tag: "1.9-211"                     # was: next-1.9
```

## Step 4: Create the PR

Push the branch and open a PR. The default test suite runs automatically on PR creation and on every new push.

### Skip the community image build

Since you are testing a pre-built productized image, there is no need to build the community image. Add `[skip-build]` to your commit messages to save time:

```
chore: test rhdh 1.9-211 [skip-build]
```

## Running Additional Test Suites

To see the full list of available test suites, post the following comment on the PR:

```
/test ?
```

CI will reply with a list of test suite commands. Copy the desired command and post it as a new comment to trigger that suite.

## Testing on a Custom OpenShift Cluster

By default, CI tests run on ephemeral clusters from the cluster pool. To test on a specific OpenShift cluster instead, add the following overrides to `openshift-ci-tests.sh` (alongside the exports from Step 1):

```bash
export K8S_CLUSTER_URL='https://api.<your-cluster>:443'
export OCM_CLUSTER_TOKEN=$K8S_CLUSTER_TOKEN_TEMPORARY
export K8S_CLUSTER_TOKEN=$K8S_CLUSTER_TOKEN_TEMPORARY

# Recalculate derived variables (originally computed in env_variables.sh before the override)
export K8S_CLUSTER_TOKEN_ENCODED=$(printf "%s" "$K8S_CLUSTER_TOKEN" | base64 | tr -d '\n')
export K8S_CLUSTER_API_SERVER_URL=$(printf "%s" "$K8S_CLUSTER_URL" | base64 | tr -d '\n')
export K8S_SERVICE_ACCOUNT_TOKEN=$K8S_CLUSTER_TOKEN_ENCODED
```

Before pushing, update the `K8S_CLUSTER_TOKEN_TEMPORARY` secret in Vault with the login token from your target cluster.
