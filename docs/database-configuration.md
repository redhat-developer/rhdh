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
      database: ${POSTGRES_DB}
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
      database: ${POSTGRES_DB}
```


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

**Expected output:** Should show schemas named after plugin IDs:
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

**Verify tables are in schemas:**
```sql
\dt catalog.*
\dt scaffolder.*
\dt auth.*
```
