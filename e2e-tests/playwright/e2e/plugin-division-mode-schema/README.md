# Plugin Division Mode: Schema Test

E2E test for `pluginDivisionMode: schema` on **OpenShift (OCP)**.

## What It Tests

1. RHDH starts with a limited-permissions DB user (no `CREATEDB` privilege)
2. Plugin schemas are created in a single database (not separate databases)
3. RHDH remains functional

## Prerequisites

- RHDH deployed on OpenShift
- Access to PostgreSQL via port-forward
- `oc` CLI configured

## Setup

```bash
# Terminal 1: Start port-forward (keep this running)
oc port-forward -n rhdh-operator backstage-psql-developer-hub-0 5432:5432

# Terminal 2: Set environment variables
export SCHEMA_MODE_DB_HOST="localhost"
export SCHEMA_MODE_DB_ADMIN_PASSWORD="$(oc exec backstage-psql-developer-hub-0 -n rhdh-operator -- env | grep POSTGRESQL_ADMIN_PASSWORD | cut -d'=' -f2)"
export SCHEMA_MODE_DB_PASSWORD="test_password_123"
export NAME_SPACE_RUNTIME="rhdh-operator"
export RELEASE_NAME="developer-hub"
export JOB_NAME="operator"
export K8S_CLUSTER_URL="$(oc config view --minify -o jsonpath='{.clusters[0].cluster.server}')"
export K8S_CLUSTER_TOKEN="$(oc whoami -t)"
```

## Run Test

```bash
cd e2e-tests
yarn install

yarn playwright test playwright/e2e/plugin-division-mode-schema/verify-schema-mode.spec.ts --project=showcase-runtime-db --headed
```

## View Test Report

After tests complete, Playwright automatically serves the HTML report at **http://localhost:9323/**.

To view the report manually later:

```bash
yarn playwright show-report
```
