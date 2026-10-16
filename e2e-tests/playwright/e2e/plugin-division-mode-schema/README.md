# Plugin Division Mode: Schema E2E Tests

E2E tests for `pluginDivisionMode: schema` on OpenShift (OCP).

## What They Test

These tests verify that RHDH can successfully start and operate with `pluginDivisionMode: schema` enabled:

1. **Database user restrictions** - The configured database user has restricted permissions (NOCREATEDB), matching production managed database environments where schema mode is required.
2. **Schema mode configuration** - RHDH is configured for schema mode, including proper database connection settings and plugin division mode enabled.
3. **RHDH accessibility** - After applying schema mode configuration and restarting the deployment, RHDH becomes accessible and serves pages successfully.

Schema mode is verified indirectly through RHDH accessibility: if RHDH starts successfully and serves pages, the plugins have accessed the database and created their schemas as expected with lazy schema creation.

## Opt-In Behavior

The dedicated runtime jobs deploy PostgreSQL and discover the required `SCHEMA_MODE_*` variables automatically. Against an existing deployment, the spec attempts the same discovery before deciding whether to skip.

### When Tests Run

Discovery or caller-provided configuration must supply:

- `SCHEMA_MODE_DB_ADMIN_PASSWORD` - PostgreSQL admin password
- `SCHEMA_MODE_DB_PASSWORD` - Test user password
- Either:
  - `SCHEMA_MODE_PORT_FORWARD_NAMESPACE` + `SCHEMA_MODE_PORT_FORWARD_RESOURCE` (automatic port-forward), or
  - `SCHEMA_MODE_DB_HOST` (manual port-forward or direct access)

### When Tests Skip

Tests skip if the required credentials or connection metadata are still missing after discovery, for example when PostgreSQL is not available in the runtime namespace. A port-forward or database connection failure after setup begins fails the test.

### CI Behavior

- **`e2e-ocp-helm-runtime-nightly` / `e2e-ocp-operator-runtime-nightly`**: Run the schema tests in `showcase-runtime`, including when triggered as optional presubmits.
- **Regular OCP-version and OSD-GCP nightlies, the mandatory PR check, and AKS/EKS/GKE jobs**: Do not select the schema-mode spec.

## CI Integration

The TypeScript [`configureSchemaMode`](schema-mode-db.ts) helper discovers PostgreSQL service names and credentials in the runtime namespace and sets `SCHEMA_MODE_*` variables, including `SCHEMA_MODE_PORT_FORWARD_NAMESPACE` and `SCHEMA_MODE_PORT_FORWARD_RESOURCE`. [`runtime-deploy.ts`](../../utils/runtime-deploy.ts) calls it after deploying the internal database, and the spec retries discovery in `beforeAll` when configuration is missing.

The test spec starts `oc port-forward` in `beforeAll` and stops it in `afterAll`.

Discovery checks `${RELEASE_NAME}-postgresql` for Helm and `backstage-psql-${RELEASE_NAME}` for Operator first, then tries the other name. It reads the admin password from the corresponding database Secret and forwards the Service. The dedicated runtime jobs use their own internal PostgreSQL; discovery does not fall back to a Crunchy deployment.

Set `DEBUG_SCHEMA_MODE_PF=1` to log port-forward output.

Tests run in the `showcase-runtime` Playwright project together with `config-map.spec.ts` (see [`playwright.config.ts`](../../../playwright.config.ts)).

**Pipeline entrypoint**: [`.ci/pipelines/openshift-ci-tests.sh`](../../../../.ci/pipelines/openshift-ci-tests.sh) → `jobs/ocp-runtime.sh` (`e2e-ocp-helm-runtime-nightly` or `e2e-ocp-operator-runtime-nightly`)

**Environment baseline**: [`.ci/pipelines/env_variables.sh`](../../../../.ci/pipelines/env_variables.sh)

## Connection Retry Logic

The tests include built-in retry logic to handle transient port-forward instability in CI environments:

- Automatic retry with exponential backoff for transient connection failures
- Automatic port-forward restart when connection is refused (port-forward crashed)
- SSL fallback for PostgreSQL endpoints requiring encrypted connections

## Local / ClusterBot Runs

For deployment and the full suite, use the [dedicated runtime local-run commands](../../../../docs/e2e-tests/CI.md#runtime-tests) without `-s`.

To run only schema-mode tests against an existing deployment, follow [Managing E2E Secrets](../../../../docs/e2e-tests/managing-e2e-secrets.md#running-with-secrets), provide `K8S_CLUSTER_URL` and `K8S_CLUSTER_TOKEN`, and set `BASE_URL`, `NAME_SPACE_RUNTIME`, `RELEASE_NAME`, and `INSTALL_METHOD` for that deployment. The spec discovers its internal PostgreSQL; a direct connection instead needs `SCHEMA_MODE_DB_HOST`, `SCHEMA_MODE_DB_ADMIN_PASSWORD`, and `SCHEMA_MODE_DB_PASSWORD` supplied by the caller.

```bash
cd e2e-tests
yarn install
yarn playwright install chromium
BASE_URL=https://runtime.example.com NAME_SPACE_RUNTIME=showcase-runtime RELEASE_NAME=rhdh INSTALL_METHOD=helm \
  ./local-test.sh -- --project=showcase-runtime playwright/e2e/plugin-division-mode-schema/verify-schema-mode.spec.ts
yarn playwright show-report
```
