# Cloud SQL runtime coverage

## Prerequisites

Use the normal E2E setup for cluster access, RHDH image, catalog index, and
installation method. Helm needs the standalone RHDH chart; the cluster must
support native sidecars. The implementation's chart hooks, CR fields, image pin,
and assertions live in the [runtime configuration](../../e2e-tests/playwright/utils/runtime-config.ts)
and [Cloud SQL spec](../../e2e-tests/playwright/e2e/external-database/verify-tls-config-with-external-cloudsql.spec.ts).

Cloud SQL requires:

- The Cloud SQL Admin API enabled and a service account with Cloud SQL connection
  permissions in the instance's project.
- PostgreSQL credentials with permission to create and drop the test databases.
  Proxy IAM authorization does not replace PostgreSQL authentication.
- Cluster connectivity to Google APIs and Cloud SQL on TCP 443 and 3307. The
  proxy uses public IP by default; private-IP-only instances need a separately
  configured network path. The runner does not need direct PostgreSQL access or
  a CA PEM bundle.

Use the `rhdh` E2E secret collection. Expected CI file names and environment
variables are defined in [env_variables.sh](../../.ci/pipelines/env_variables.sh);
validation is in [cloudsql-config.ts](../../e2e-tests/playwright/utils/cloudsql-config.ts).
For authentication, profiles, retrieval, and secret lifecycle operations, follow
the upstream [Secrets API documentation](https://redhat-developer.github.io/rhdh-e2e-test-utils/api/secrets.html).
For a local run, materialize `cloudsql-service-account.json` in a private file and
set `CLOUDSQL_SERVICE_ACCOUNT_JSON_PATH` to that file. Keep the key out of command
arguments and environment variables containing JSON.

## Run

From `e2e-tests/`, with the setup environment loaded:

```bash
INSTALL_METHOD=helm CLOUDSQL_REQUIRED=true yarn playwright test --project=showcase-runtime playwright/e2e/external-database/verify-tls-config-with-external-cloudsql.spec.ts
INSTALL_METHOD=operator CLOUDSQL_REQUIRED=true yarn playwright test --project=showcase-runtime playwright/e2e/external-database/verify-tls-config-with-external-cloudsql.spec.ts
```

Helm and Operator nightly jobs already run `showcase-runtime`. Required coverage
defaults on in CI. For local verification, use `CLOUDSQL_REQUIRED=true` and check
that all four cases actually ran on both installation methods. An all-skipped
result does not establish coverage. Run `yarn showcase-runtime` for the surrounding
configuration, schema-mode, RDS, and Azure regression tests.

## Interrupted-run recovery

Inspect the `cloudsql-target` and `cloudsql-cleanup` test attachments for the
namespace, actual PostgreSQL version, database prefix, and cleanup result. A
forcibly terminated runner can leave resources even though normal teardown is
retry-safe; the [fixture](../../e2e-tests/playwright/support/fixtures/cloudsql-runtime.ts)
owns that lifecycle.

Stop the recorded run's RHDH pods before removing its databases, then use an
independent Auth Proxy to drop only databases with the recorded exact prefix.
Remove the recorded namespace and any surviving local port-forward process.
Never clear every non-system database on a shared instance. Ordinary drops avoid
requiring permission to signal Cloud SQL's privileged processes with `FORCE`.
