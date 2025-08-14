# Audit Logging for RHDH

RHDH supports audit logging for both the catalog and scaffolder. Audit logs can be identified by the `isAuditLog: true` field.

## Configuring the audit logger

### Logging to Console

By default, the audit logger logs to the console. To disable this, update your app-config.yaml with:

```yaml
auditLog:
  console:
    enabled: false
```
