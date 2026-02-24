# Plugin Division Mode: Schema Tests

This directory contains tests for the `pluginDivisionMode: schema` feature, which allows RHDH to use PostgreSQL schemas instead of separate databases for plugin isolation.

## Test Overview

These tests verify that:
1. RHDH can start successfully with a database user that has limited permissions (no `CREATEDB` privilege)
2. Plugin schemas are created correctly within a single database
3. No separate plugin databases are created
4. RHDH remains functional with schema mode enabled

## Prerequisites

The tests require a PostgreSQL database with:
- An admin user (with `CREATEDB` and `CREATEROLE` privileges)
- A test database that will be created automatically
- A limited-permissions user that will be created automatically

## Environment Variables

The following environment variables must be set:

### Required
- `SCHEMA_MODE_DB_HOST` - PostgreSQL host
- `SCHEMA_MODE_DB_ADMIN_PASSWORD` - Password for admin user (defaults to `postgres` user)
- `SCHEMA_MODE_DB_PASSWORD` - Password for the limited-permissions test user

### Optional
- `SCHEMA_MODE_DB_ADMIN_USER` - Admin user (default: `postgres`)
- `SCHEMA_MODE_DB_NAME` - Test database name (default: `backstage_schema_test`)
- `SCHEMA_MODE_DB_USER` - Limited-permissions user name (default: `backstage_schema_user`)
- `NAME_SPACE_RUNTIME` - Kubernetes namespace (default: `showcase-runtime`)
- `RELEASE_NAME` - RHDH release name
- `JOB_NAME` - CI job name (used to determine deployment name)

## Test Setup

The test automatically:
1. Creates a test database
2. Creates a limited-permissions user (no `CREATEDB` privilege)
3. Grants `CONNECT` and `CREATE SCHEMA` privileges on the test database
4. Configures RHDH to use schema mode
5. Restarts RHDH deployment

## Running the Tests

### Local Testing

**Option 1: Run with local test setup (recommended for debugging)**

```bash
# 1. Deploy RHDH to cluster (if not already deployed)
cd e2e-tests
./local-run.sh
# Select: Deploy only

# 2. Set up environment
source local-test-setup.sh

# 3. Run the test
yarn install
yarn playwright test playwright/e2e/plugin-division-mode-schema/verify-schema-mode.spec.ts --project=showcase-runtime-db --headed
```

**Option 2: Run directly (requires all environment variables set)**

```bash
cd e2e-tests
yarn install
yarn playwright test playwright/e2e/plugin-division-mode-schema/verify-schema-mode.spec.ts --project=showcase-runtime-db
```

### CI Integration

The test is included in the `SHOWCASE_RUNTIME_DB` project, which runs before `SHOWCASE_RUNTIME`. This ensures:
- Database setup is verified before runtime tests
- Schema mode is tested alongside other external database configurations
- Tests run in CI pipelines automatically

The test will run in CI when:
- External database tests are executed (nightly, PR tests with external DB)
- Environment variables are provided by the CI pipeline

## Database User Permissions

The test user has:
- `CONNECT` privilege on the test database
- `CREATE SCHEMA` privilege on the test database
- **No** `CREATEDB` privilege (this is the key requirement for schema mode)

This simulates a production environment where database users cannot create databases.

## Relationship to External Database Tests

The schema mode test is part of the `SHOWCASE_RUNTIME_DB` project, which also includes:
- `verify-tls-config-with-external-rds.spec.ts` - Tests RDS PostgreSQL connection
- `verify-tls-config-with-external-azure-db.spec.ts` - Tests Azure PostgreSQL connection

**Important:** The external database tests currently use the **default database mode** (separate databases per plugin). The schema mode test is a **separate, dedicated test** that specifically verifies schema mode functionality.

### Should External DB Tests Also Test Schema Mode?

**Current approach:** Schema mode has its own dedicated test suite to keep it isolated and simple.

**Future consideration:** External database tests could optionally test schema mode as well, but this would require:
- Additional test configuration
- More complex setup (creating limited-permissions users)
- Potentially longer test execution time

For now, the dedicated schema mode test provides focused verification of the feature without complicating existing external database tests.
