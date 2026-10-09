# Cloud SQL runtime prerequisites

Use the normal E2E cluster and installation setup with a cluster supporting native
sidecars and, for Helm, the standalone RHDH chart. Cloud SQL additionally needs:

- The Cloud SQL Admin API enabled and a service account with Cloud SQL connection
  permissions in the instance's project. PostgreSQL credentials separately need
  permission to create and drop databases; proxy IAM authorization does not grant it.
- Cluster access to Google APIs and Cloud SQL on TCP 443 and 3307. Private-IP-only
  instances need a separately configured network path. The runner needs neither
  direct PostgreSQL access nor a Cloud SQL CA bundle.

Use the `rhdh` E2E secret collection; follow the upstream
[Secrets API documentation](https://redhat-developer.github.io/rhdh-e2e-test-utils/api/secrets.html)
for retrieval. For local runs, store the service-account JSON in a private file
and point `CLOUDSQL_SERVICE_ACCOUNT_JSON_PATH` at it, rather than putting the key
in command arguments or environment variables containing JSON.

RDS/Azure use direct PostgreSQL TLS instead: both the runner and RHDH need endpoint
access and a provider CA bundle. An absent endpoint skips its slot; a configured
endpoint with missing credentials or CA fails validation. Reports identify endpoint
slots and attach the actual PostgreSQL version rather than assuming `latest-*`.

## Interrupted-run recovery

A forcibly terminated runner may leave resources. Use the `cloudsql-target` and
`cloudsql-cleanup` attachments to identify the namespace and exact database prefix.
Stop that run's RHDH pods, then use an independent Auth Proxy to drop only its
databases. Remove the namespace and surviving local port-forward processes.
Ordinary drops avoid needing permission to signal privileged Cloud SQL processes
with `FORCE`.
For RDS/Azure, use the `runtime-database-target` and `runtime-database-cleanup`
attachments and a direct TLS connection to recover the exact run/slot prefix.
Cleanup failures include remaining session metadata without query text or credentials.
