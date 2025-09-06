# OCP Ephemeral Environment

## Overview

The RHDH deployment for end-to-end (e2e) tests in CI has been updated to use **ephemeral clusters**
on OpenShift Container Platform (OCP) instead of persistent clusters.

### Key Updates

- Starting from version **1.5**, ephemeral clusters are used for:
  - OCP nightly jobs (v4.17, v4.16, and v4.14).
  - PR checks on the main branch.
- Previously, RHDH PR checks utilized persistent clusters created on IBM Cloud.
- Now, ephemeral clusters are provisioned using the **OpenShift CI cluster claim** on AWS via the
  RHDH-QE account in the `us-east-2` region.

---

## Access Requirements

To access ephemeral clusters, you must:

1. Be a **Cluster Pool Admin**.
2. Join the **Rover Group**:
   [rhdh-pool-admins](https://rover.redhat.com/groups/group/rhdh-pool-admins).

---

## Cluster Pools

The following cluster pools are available for different OCP versions:

- **RHDH-4-19-US-EAST-2**
  - Usage: OCP v4.19 nightly jobs.
  - [Cluster Pool Configuration](https://github.com/openshift/release/blob/master/clusters/hosted-mgmt/hive/pools/rhdh/rhdh-ocp-4-19-0-amd64-aws-us-east-2_clusterpool.yaml).

- **RHDH-4-18-US-EAST-2**
  - Usage: OCP v4.18 nightly jobs.
  - [Cluster Pool Configuration](https://github.com/openshift/release/blob/master/clusters/hosted-mgmt/hive/pools/rhdh/rhdh-ocp-4-18-0-amd64-aws-us-east-2_clusterpool.yaml).

- **RHDH-4-17-US-EAST-2**
  - Usage: PR checks on the main branch and OCP v4.17 nightly jobs.
  - [Cluster Pool Configuration](https://github.com/openshift/release/blob/master/clusters/hosted-mgmt/hive/pools/rhdh/rhdh-ocp-4-17-0-amd64-aws-us-east-2_clusterpool.yaml).

- **RHDH-4-16-US-EAST-2**
  - Usage: OCP v4.16 nightly jobs.
  - [Cluster Pool Configuration](https://github.com/openshift/release/blob/master/clusters/hosted-mgmt/hive/pools/rhdh/rhdh-ocp-4-16-0-amd64-aws-us-east-2_clusterpool.yaml).

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
[.ibm/pipelines/ocp-cluster-claim-login.sh](ocp-cluster-claim-login.sh) script to log in and
retrieve ephemeral environment credentials.

### Steps:

1. Run the script:
   ```bash
   .ibm/pipelines/ocp-cluster-claim-login.sh
   ```
2. Provide the Prow log URL when prompted, for example:
   `https://prow.ci.openshift.org/view/gs/test-platform-results/pr-logs/pull/janus-idp_backstage-showcase/2089/pull-ci-janus-idp-backstage-showcase-main-e2e-tests/1866766753132974080 `
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

# Installation Instructions for Tests

For tests dependent on `backstage-community-plugin-ocm-backend-dynamic` and
`backstage-community-plugin-ocm`, it's necessary to install **Advanced Cluster Management for
Kubernetes "MultiClusterHub"**.

Please follow these steps for installation:

1. Visit
   [Installing Advanced Cluster Management for Kubernetes "MultiClusterHub"](https://access.redhat.com/documentation/en-us/red_hat_advanced_cluster_management_for_kubernetes/2.10/html/install/installing#installing-from-the-operatorhub)
   for detailed instructions on installing from the OperatorHub.
