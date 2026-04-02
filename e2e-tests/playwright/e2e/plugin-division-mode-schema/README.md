# Plugin Division Mode: Schema E2E Tests

E2E tests for `pluginDivisionMode: schema` on **OpenShift (OCP)**. Two specs exist: **Helm** (`verify-schema-mode-helm.spec.ts`) and **Operator** (`verify-schema-mode-operator.spec.ts`). Each skips when `JOB_NAME` suggests the other install type.

## What they test

1. **DB user posture** — The configured DB user cannot create databases (NOCREATEDB).
2. **RHDH with schema mode** — After configuring for schema mode and restarting when needed, RHDH is reachable (e.g. guest login). They do **not** assert specific plugin schema names (upstream Backstage).

## Opt-In Behavior

**Schema-mode tests are OPT-IN.** They only run when the required `SCHEMA_MODE_*` environment variables are configured:

### When Tests RUN
- ✅ `SCHEMA_MODE_DB_ADMIN_PASSWORD` is set (PostgreSQL admin password)
- ✅ `SCHEMA_MODE_DB_PASSWORD` is set (test user password)
- ✅ Either:
  - `SCHEMA_MODE_PORT_FORWARD_NAMESPACE` + `SCHEMA_MODE_PORT_FORWARD_RESOURCE` are set (CI auto-discovery), OR
  - `SCHEMA_MODE_DB_HOST` is set (manual port-forward or direct access)

### When Tests SKIP
- ❌ Any required `SCHEMA_MODE_*` variable is missing
- ❌ PostgreSQL is not available in the runtime namespace
- ❌ Port-forward fails to establish connection

**Expected in CI:**
- **OCP Helm/Operator nightly jobs**: Tests run (env auto-configured by `schema-mode-env.sh`)
- **PR jobs**: Tests skip (env not configured by default)
- **Non-OCP jobs (AKS, EKS, GKE)**: Tests skip (no PostgreSQL deployment)

## CI (nightly / Prow)

On **OCP Helm** and **OCP Operator** nightly jobs, [`.ci/pipelines/lib/schema-mode-env.sh`](../../../../.ci/pipelines/lib/schema-mode-env.sh) runs before the runtime Playwright project: it discovers PostgreSQL credentials and exports `SCHEMA_MODE_*`, including **`SCHEMA_MODE_PORT_FORWARD_NAMESPACE`** and **`SCHEMA_MODE_PORT_FORWARD_RESOURCE`** (`svc/...` or `pod/...`). The schema specs then start **`oc port-forward` in `beforeAll`** (same idea as [`verify-redis-cache.spec.ts`](../../verify-redis-cache.spec.ts)) and tear it down in `afterAll`. For **Helm** when the runtime namespace has no Bitnami `*-postgresql` Service, discovery uses the Crunchy cluster in `NAME_SPACE_POSTGRES_DB`: admin password from `${SCHEMA_MODE_CRUNCHY_CLUSTER_NAME:-postgress-external-db}-pguser-janus-idp`, and forward target is a **Running postgres pod** (the `*-primary` Service has no selector, so forwarding the Service fails). Optional override: `SCHEMA_MODE_CRUNCHY_CLUSTER_NAME` if your `PostgresCluster` metadata name differs. Set **`DEBUG_SCHEMA_MODE_PF=1`** to log port-forward output. Tests run in the **`showcase-runtime`** Playwright project together with `config-map.spec.ts` (see [`playwright.config.ts`](../../../playwright.config.ts)).

Entrypoints: [`.ci/pipelines/openshift-ci-tests.sh`](../../../../.ci/pipelines/openshift-ci-tests.sh) → `jobs/ocp-nightly.sh` / `jobs/ocp-operator.sh`. Baseline env: [`.ci/pipelines/env_variables.sh`](../../../../.ci/pipelines/env_variables.sh). Local overrides: `.ci/pipelines/env_override.local.sh`.

## Cluster capacity

If you see **`Insufficient cpu`**, Pending pods, or unschedulable workloads, **scale the cluster** or free capacity elsewhere. Chart values in this tree may change over time; there is no guarantee they are tuned for a specific cluster size.

## Local / ClusterBot runs

Use [`e2e-tests/local-run.sh`](../../../local-run.sh) with a `JOB_NAME` that matches your target (e.g. `*ocp*helm*nightly*` for Helm). For ad-hoc runs against an existing cluster:

1. Either run the same discovery as CI (source or replicate what [`schema-mode-env.sh`](../../../../.ci/pipelines/lib/schema-mode-env.sh) exports) so the specs can start **`oc port-forward`**, **or** manually port-forward and set **`SCHEMA_MODE_DB_HOST=localhost`** plus passwords.
2. Set **`SCHEMA_MODE_DB_ADMIN_PASSWORD`**, **`SCHEMA_MODE_DB_PASSWORD`**, **`NAME_SPACE_RUNTIME`**, **`RELEASE_NAME`**, and **`JOB_NAME`** so Helm vs Operator skip logic matches your deployment (and forward metadata or `SCHEMA_MODE_DB_HOST` as above).
3. **`K8S_CLUSTER_URL`** and **`K8S_CLUSTER_TOKEN`** are only needed if the tests must talk to the API from your machine; OpenShift CI already sets them in jobs.

```bash
cd e2e-tests
yarn install
yarn playwright install chromium
yarn playwright test playwright/e2e/plugin-division-mode-schema/verify-schema-mode-helm.spec.ts --project=any-test
# or verify-schema-mode-operator.spec.ts
yarn playwright show-report
```
