# Plugin Division Mode: Schema Test

E2E test for `pluginDivisionMode: schema` on **OpenShift (OCP)**.

## What It Tests

1. RHDH starts with a limited-permissions DB user (no `CREATEDB` privilege)
2. Plugin schemas are created in a single database (not separate databases)
3. RHDH remains functional

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

yarn playwright test playwright/e2e/plugin-division-mode-schema/verify-schema-mode-operator.spec.ts --project=showcase-runtime-db --headed
```

### For Helm Chart Deployment

```bash
cd e2e-tests
yarn install

yarn playwright test playwright/e2e/plugin-division-mode-schema/verify-schema-mode-helm.spec.ts --project=showcase-runtime-db --headed
```

## View Test Report

After tests complete, Playwright automatically serves the HTML report at **http://localhost:9323/**.

To view the report manually later:

```bash
yarn playwright show-report
```

## Deployment Type Differences

| Resource | Operator | Helm Chart |
|----------|----------|------------|
| Deployment | `backstage-${RELEASE_NAME}` | `${RELEASE_NAME}` |
| PostgreSQL Pod | `backstage-psql-${RELEASE_NAME}-0` | `${RELEASE_NAME}-postgresql-0` |
| PostgreSQL Service | `backstage-psql-${RELEASE_NAME}` | `${RELEASE_NAME}-postgresql` |
| ConfigMap | `backstage-appconfig-${RELEASE_NAME}` | `${RELEASE_NAME}-app-config` |
| Secret | `postgres-cred` | `${RELEASE_NAME}-postgresql` |
| Default DB User | `backstage_schema_user` | `bn_backstage` |
| Test File | `verify-schema-mode-operator.spec.ts` | `verify-schema-mode-helm.spec.ts` |
