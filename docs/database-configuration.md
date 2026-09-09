# Database Configuration

## PostgreSQL Configuration

RHDH supports PostgreSQL as the backend database. Configure it in your `app-config.yaml`:

```yaml
backend:
  database:
    client: pg
    connection:
      host: ${POSTGRES_HOST}
      port: ${POSTGRES_PORT}
      user: ${POSTGRES_USER}
      password: ${POSTGRES_PASSWORD}
```

## Plugin Division Mode: Schema

By default, RHDH creates a separate database for each plugin (e.g., `backstage_plugin_catalog`, `backstage_plugin_scaffolder`). This requires the database user to have `CREATEDB` privileges.

For environments with strict security policies that prohibit database creation, use `pluginDivisionMode: schema` to isolate plugins using PostgreSQL schemas within a single database:

```yaml
backend:
  database:
    client: pg
    pluginDivisionMode: schema
    connection:
      host: ${POSTGRES_HOST}
      port: ${POSTGRES_PORT}
      user: ${POSTGRES_USER}
      password: ${POSTGRES_PASSWORD}
```

**Note:** By default, RHDH automatically creates the required schemas. If your database user lacks `CREATE SCHEMA` privileges, add `ensureSchemaExists: false` to the database configuration and ensure all required schemas are created upfront by your database administrator.

### Schema Name Prefix

When using `pluginDivisionMode: schema`, you can optionally prefix all schema names to avoid conflicts with existing PostgreSQL schemas (e.g., extensions created by pgvector, PostGIS, or other database extensions):

```yaml
backend:
  database:
    client: pg
    pluginDivisionMode: schema
    schemaPrefix: 'rhdh_'  # Prefix all schema names
    connection:
      host: ${POSTGRES_HOST}
      port: ${POSTGRES_PORT}
      user: ${POSTGRES_USER}
      password: ${POSTGRES_PASSWORD}
```

With the example above, RHDH will create schemas like:
- `rhdh_catalog` instead of `catalog`
- `rhdh_auth` instead of `auth`
- `rhdh_extensions` instead of `extensions` (avoids conflict with pgvector)
- `rhdh_scaffolder` instead of `scaffolder`

**Important:**
- Defaults to empty string (no prefix) for backward compatibility
- Schema names (including prefix) are limited to 63 characters by PostgreSQL
- The prefix is applied to all plugin schemas consistently

**Use cases:**
- Database has existing schemas that conflict with plugin IDs (e.g., `extensions` from pgvector)
- DBA policies prohibit renaming existing schemas
- Multi-tenant environments where multiple RHDH instances share a database

### Verification

After RHDH starts with `pluginDivisionMode: schema`, verify schemas were created:

**Connect to PostgreSQL:**
```bash
psql -U postgres
```

**List all schemas:**
```sql
\dn
```

**Expected output (without prefix):** Should show schemas named after plugin IDs:
```
      List of schemas
  Name  |       Owner       
--------+-------------------
 adoption-insights    | postgres
 app                  | postgres
 auth                 | postgres
 catalog              | postgres
 dynamic-plugins-info | postgres
 events               | postgres
 extensions           | postgres
 healthcheck          | postgres
 licensed-users-info  | postgres
 permission           | postgres
 proxy                | postgres
 public               | pg_database_owner
 scaffolder           | postgres
 scalprum             | postgres
 search               | postgres
 techdocs             | postgres
 translations         | postgres
 user-settings        | postgres
(18 rows)
```

**Expected output (with `schemaPrefix: 'rhdh_'`):** Should show schemas with the configured prefix:
```
      List of schemas
         Name          |       Owner       
-----------------------+-------------------
 extensions            | postgres          ← Pre-existing schema (no conflict!)
 public                | pg_database_owner
 rhdh_adoption-insights| postgres
 rhdh_app              | postgres
 rhdh_auth             | postgres
 rhdh_catalog          | postgres
 rhdh_dynamic-plugins-info | postgres
 rhdh_events           | postgres
 rhdh_extensions       | postgres          ← RHDH's extensions schema (prefixed)
 rhdh_healthcheck      | postgres
 rhdh_licensed-users-info | postgres
 rhdh_permission       | postgres
 rhdh_proxy            | postgres
 rhdh_scaffolder       | postgres
 rhdh_scalprum         | postgres
 rhdh_search           | postgres
 rhdh_techdocs         | postgres
 rhdh_translations     | postgres
 rhdh_user-settings    | postgres
(20 rows)
```

**Verify tables are in prefixed schemas:**
```sql
-- Without prefix:
\dt catalog.*
\dt scaffolder.*
\dt auth.*

-- With prefix:
\dt rhdh_catalog.*
\dt rhdh_scaffolder.*
\dt rhdh_auth.*
```
