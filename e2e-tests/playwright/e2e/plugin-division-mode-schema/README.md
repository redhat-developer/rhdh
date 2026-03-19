# Plugin Division Mode: Schema Test

E2E test for `pluginDivisionMode: schema` on **OpenShift (OCP)**.

## What It Tests

These tests focus on **RHDH behavior** with `pluginDivisionMode: schema`, not on upstream Backstage or Knex internals:

1. **DB user has restricted permissions** — Before starting, we assert the configured DB user cannot create databases (NOCREATEDB). This matches environments where schema mode is required (e.g. managed PostgreSQL without `CREATEDB`).
2. **RHDH works with schema mode** — After configuring RHDH for schema mode and restarting, we verify RHDH is accessible (e.g. guest login, UI loads). We do _not_ assert that specific schemas exist or that no plugin databases were created; that behavior is guaranteed by upstream Backstage.

## Prerequisites

- RHDH deployed on OpenShift (Operator or Helm chart)
- Access to PostgreSQL via port-forward
- `oc` CLI configured

## Setup

### If Using Operator Deployment

```bash
# Terminal 1: Start port-forward (keep this running)
oc port-forward -n rhdh-operator backstage-psql-developer-hub-0 5432:5432

# Terminal 2: Set environment variables
export SCHEMA_MODE_DB_HOST="localhost"
export SCHEMA_MODE_DB_ADMIN_PASSWORD="$(oc exec backstage-psql-developer-hub-0 -n rhdh-operator -- env | grep POSTGRESQL_ADMIN_PASSWORD | cut -d'=' -f2)"
export SCHEMA_MODE_DB_PASSWORD="test_password_123"
export NAME_SPACE_RUNTIME="rhdh-operator"
export RELEASE_NAME="developer-hub"
export K8S_CLUSTER_URL="$(oc config view --minify -o jsonpath='{.clusters[0].cluster.server}')"
export K8S_CLUSTER_TOKEN="$(oc whoami -t)"
```

### If Using Helm Chart Deployment

```bash
# Terminal 1: Start port-forward (keep this running)
oc port-forward -n rhdh-chart redhat-developer-hub-postgresql-0 5432:5432

# Terminal 2: Set environment variables
export SCHEMA_MODE_DB_HOST="localhost"
export SCHEMA_MODE_DB_ADMIN_PASSWORD="$(oc get secret redhat-developer-hub-postgresql -n rhdh-chart -o jsonpath='{.data.postgres-password}' | base64 -d)"
export SCHEMA_MODE_DB_PASSWORD="test_password_123"
export NAME_SPACE_RUNTIME="rhdh-chart"
export RELEASE_NAME="redhat-developer-hub"
export K8S_CLUSTER_URL="$(oc config view --minify -o jsonpath='{.clusters[0].cluster.server}')"
export K8S_CLUSTER_TOKEN="$(oc whoami -t)"
```

## Run Test

### For Operator Deployment

```bash
cd e2e-tests
yarn install

yarn playwright test playwright/e2e/plugin-division-mode-schema/verify-schema-mode-operator.spec.ts --project=any-test --headed
```

### For Helm Chart Deployment

```bash
cd e2e-tests
yarn install

yarn playwright test playwright/e2e/plugin-division-mode-schema/verify-schema-mode-helm.spec.ts --project=any-test --headed
```

## View Test Report

After tests complete, Playwright automatically serves the HTML report at **http://localhost:9323/**.

To view the report manually later:

```bash
yarn playwright show-report
```
