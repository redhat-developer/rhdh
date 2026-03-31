# OCP Ephemeral Environment

## Overview

The RHDH deployment for end-to-end (e2e) tests in CI uses **ephemeral clusters** on OpenShift
Container Platform (OCP).

### Key Details

- Ephemeral OCP clusters are provisioned using the **OpenShift CI cluster claim** on AWS via the
  RHDH-QE account in the `us-east-2` region.
- Used for OCP nightly jobs (multiple OCP versions) and PR checks on the main branch.
- Non-OCP platforms (AKS, EKS) use ephemeral clusters provisioned by
  [Mapt](https://github.com/redhat-developer/mapt). GKE uses a long-running shared cluster.

---

## Access Requirements

To access ephemeral clusters, you must:

1. Be a **Cluster Pool Admin**.
2. Join the **Rover Group**:
   [rhdh-pool-admins](https://rover.redhat.com/groups/group/rhdh-pool-admins).

---

## Cluster Pools

RHDH uses dedicated Hive cluster pools with the `rhdh` prefix. Pool versions rotate as new OCP
releases come out.

To find the current list of available pools, filter for `rhdh` in the
[existing cluster pools](https://docs.ci.openshift.org/how-tos/cluster-claim/#existing-cluster-pools)
page.

---

## Using Cluster Claims in OpenShift CI Jobs

Ephemeral clusters can be utilized in CI jobs by defining a `cluster_claim` stanza with values
matching the labels on the pool.  
Additionally, include the workflow: `generic-claim` for setup and cleanup.

### Example Configuration

```yaml
- as: e2e-tests-nightly
  cluster_claim:
    architecture: amd64
    cloud: aws
    labels:
      region: us-east-2
    owner: rhdh
    product: ocp
    timeout: 1h0m0s
    version: "4.17"
  cron: 0 7 * * *
  steps:
    test:
      - ref: janus-idp-backstage-showcase-nightly
    workflow: generic-claim
```

## Debugging

If you are a member of the `rhdh-pool-admins` group, you can use the
[.ci/pipelines/ocp-cluster-claim-login.sh](ocp-cluster-claim-login.sh) script to log in and retrieve
ephemeral environment credentials.

### Steps:

1. Run the script:
   ```bash
   .ci/pipelines/ocp-cluster-claim-login.sh
   ```
2. Provide the Prow log URL when prompted, for example:
   `https://prow.ci.openshift.org/view/gs/test-platform-results/logs/periodic-ci-redhat-developer-rhdh-main-e2e-ocp-helm-nightly/<BUILD_ID>`
3. The script will:
   - Log in to the hosted-mgmt cluster, which manages ephemeral cluster creation.
   - Retrieve admin credentials and log in to the ephemeral cluster.
   - Prompt to open the OCP web console directly in the browser.
4. Note:
   - The ephemeral cluster is deleted as soon as the CI job terminates.
   - To retain the cluster for a longer duration, add a sleep command in the
     [openshift-ci-tests.sh](openshift-ci-tests.sh) script, e.g.:
     ```bash
     ...
     echo "Main script completed with result: ${OVERALL_RESULT}"
     sleep 60*60
     exit "${OVERALL_RESULT}"
     ...
     ```

### For detailed documentation, refer to: [Openshift-ci cluster claim docs](https://docs.ci.openshift.org/docs/how-tos/cluster-claim/)

## Keycloak Authentication for Tests

- All tests on the main branch use Keycloak as the default authentication provider.
- Keycloak is deployed on the pr-os cluster.

### Keycloak Instance Details:

- URL:
  [Keycloak Admin Console](https://keycloak-rhsso.rhdh-pr-os-a9805650830b22c3aee243e51d79565d-0000.us-east.containers.appdomain.cloud/auth/admin/master/console/#/realms/rhdh-login-test)
- Credentials: These can be found in the RHDH-QE Vault under the following keys:
  - `KEYCLOAK_AUTH_BASE_URL`
  - `KEYCLOAK_AUTH_CLIENTID`
  - `KEYCLOAK_AUTH_CLIENT_SECRET`
  - `KEYCLOAK_AUTH_LOGIN_REALM`
  - `KEYCLOAK_AUTH_REALM`

---

## Development Guidelines

### Code Quality

The `.ci` directory contains linting and formatting tools for pipeline scripts.

Install dependencies:

```bash
cd .ci
yarn install
```

Available commands:

- `yarn shellcheck` - Lint shell scripts (must pass with zero warnings)
- `yarn prettier:check` - Check file formatting
- `yarn prettier:fix` - Auto-format files

Before submitting a PR:

```bash
cd .ci
yarn prettier:fix
yarn shellcheck
```

### Modular Architecture

Pipeline utilities are organized into modules in `.ci/pipelines/lib/`. See
[`lib/README.md`](lib/README.md) for the full list of modules, function signatures, and conventions.

For detailed triage and failure investigation, see the
[CI Medic Guide](../../docs/e2e-tests/CI-medic-guide.md).
