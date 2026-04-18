# Plugin Division Mode: Schema E2E Tests

E2E tests for `pluginDivisionMode: schema` on OpenShift (OCP). Two specs exist: **Helm** (`verify-schema-mode-helm.spec.ts`) and **Operator** (`verify-schema-mode-operator.spec.ts`). Each skips when `JOB_NAME` suggests the other install type.

## What They Test

These tests verify that RHDH can successfully start and operate with `pluginDivisionMode: schema` enabled:

1. **Database user restrictions** - The configured database user has restricted permissions (NOCREATEDB), matching production managed database environments where schema mode is required.
2. **Schema mode configuration** - RHDH is configured for schema mode, including proper database connection settings and plugin division mode enabled.
3. **RHDH accessibility** - After applying schema mode configuration and restarting the deployment, RHDH becomes accessible and serves pages successfully.

Schema mode is verified indirectly through RHDH accessibility: if RHDH starts successfully and serves pages, the plugins have accessed the database and created their schemas as expected with lazy schema creation.

## Opt-In Behavior

Schema-mode tests are opt-in. They only run when the required `SCHEMA_MODE_*` environment variables are configured.

### When Tests Run

The following environment variables must be set:

- `SCHEMA_MODE_DB_ADMIN_PASSWORD` - PostgreSQL admin password
- `SCHEMA_MODE_DB_PASSWORD` - Test user password
- Either:
  - `SCHEMA_MODE_PORT_FORWARD_NAMESPACE` + `SCHEMA_MODE_PORT_FORWARD_RESOURCE` (CI auto-discovery), or
  - `SCHEMA_MODE_DB_HOST` (manual port-forward or direct access)

### When Tests Skip

Tests skip when:

- Any required `SCHEMA_MODE_*` variable is missing
- PostgreSQL is not available in the runtime namespace
- Port-forward fails to establish connection

### CI Behavior

- **OCP Helm/Operator nightly jobs**: Tests run (env auto-configured by `schema-mode-env.sh`)
- **PR jobs**: Tests skip (env not configured by default)
- **Non-OCP jobs (AKS, EKS, GKE)**: Tests skip (no PostgreSQL deployment)

## CI Integration

On OCP Helm and OCP Operator nightly jobs, [`.ci/pipelines/lib/schema-mode-env.sh`](../../../../.ci/pipelines/lib/schema-mode-env.sh) runs before the runtime Playwright project to discover PostgreSQL credentials and export `SCHEMA_MODE_*` variables, including `SCHEMA_MODE_PORT_FORWARD_NAMESPACE` and `SCHEMA_MODE_PORT_FORWARD_RESOURCE` (`svc/...` or `pod/...`).

The test specs start `oc port-forward` in `beforeAll` (similar to [`verify-redis-cache.spec.ts`](../../verify-redis-cache.spec.ts)) and stop it in `afterAll`.

For **Helm** deployments when the runtime namespace has no Bitnami `*-postgresql` Service, auto-discovery uses the Crunchy cluster in `NAME_SPACE_POSTGRES_DB`:

- Admin password from `${SCHEMA_MODE_CRUNCHY_CLUSTER_NAME:-postgress-external-db}-pguser-janus-idp`
- Forward target is a Running postgres pod (the `*-primary` Service has no selector, so forwarding the Service fails)
- Override cluster name with `SCHEMA_MODE_CRUNCHY_CLUSTER_NAME` if your `PostgresCluster` metadata name differs

Set `DEBUG_SCHEMA_MODE_PF=1` to log port-forward output.

Tests run in the `showcase-runtime` Playwright project together with `config-map.spec.ts` (see [`playwright.config.ts`](../../../playwright.config.ts)).

**Pipeline entrypoints**: [`.ci/pipelines/openshift-ci-tests.sh`](../../../../.ci/pipelines/openshift-ci-tests.sh) → `jobs/ocp-nightly.sh` / `jobs/ocp-operator.sh`

**Environment baseline**: [`.ci/pipelines/env_variables.sh`](../../../../.ci/pipelines/env_variables.sh)

**Local overrides**: `.ci/pipelines/env_override.local.sh`

## Connection Retry Logic

The tests include built-in retry logic to handle transient port-forward instability in CI environments:

- Automatic retry with exponential backoff for transient connection failures
- Automatic port-forward restart when connection is refused (port-forward crashed)
- SSL fallback for Crunchy PostgreSQL clusters requiring encrypted connections

This makes the tests resilient to temporary infrastructure issues while still validating schema mode functionality.

## Cluster Capacity

If you see `Insufficient cpu`, Pending pods, or unschedulable workloads, scale the cluster or free capacity elsewhere. Chart values in this tree may change over time; there is no guarantee they are tuned for a specific cluster size.

## Local / ClusterBot Runs

Use [`e2e-tests/local-run.sh`](../../../local-run.sh) with a `JOB_NAME` that matches your target (e.g. `*ocp*helm*nightly*` for Helm).

For ad-hoc runs against an existing cluster:

1. Either run the same discovery as CI (source or replicate what [`schema-mode-env.sh`](../../../../.ci/pipelines/lib/schema-mode-env.sh) exports) so the specs can start `oc port-forward`, or manually port-forward and set `SCHEMA_MODE_DB_HOST=localhost` plus passwords.

2. Set required environment variables:
   - `SCHEMA_MODE_DB_ADMIN_PASSWORD`
   - `SCHEMA_MODE_DB_PASSWORD`
   - `NAME_SPACE_RUNTIME`
   - `RELEASE_NAME`
   - `JOB_NAME` (so Helm vs Operator skip logic matches your deployment)
   - Forward metadata or `SCHEMA_MODE_DB_HOST` as described above

3. `K8S_CLUSTER_URL` and `K8S_CLUSTER_TOKEN` are only needed if the tests must talk to the API from your machine; OpenShift CI already sets them in jobs.

```bash
cd e2e-tests
yarn install
yarn playwright install chromium
yarn playwright test playwright/e2e/plugin-division-mode-schema/verify-schema-mode-helm.spec.ts --project=any-test
# or verify-schema-mode-operator.spec.ts
yarn playwright show-report
```
