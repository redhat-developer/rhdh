# Local E2E Testing Configuration

This folder contains configuration files for running e2e tests locally using [rhdh-local](https://github.com/redhat-developer/rhdh-local).

## Files

| File | Description |
|------|-------------|
| `config-basic.yaml` | Minimal config for basic testing with guest auth |
| `config-rbac.yaml` | Config with RBAC/permissions enabled |
| `defaults.env` | Environment variable defaults (not currently used) |

## Usage

From the repository root:

```bash
# Basic tests
./scripts/run-e2e-tests.sh --project showcase-sanity-plugins

# RBAC tests
./scripts/run-e2e-tests.sh --profile rbac --project showcase-rbac

# Build and test local changes
./scripts/run-e2e-tests.sh --build --project showcase-sanity-plugins
```

## Profiles

| Profile | Config File | Use Case |
|---------|-------------|----------|
| `basic` | `config-basic.yaml` | General testing with guest auth |
| `rbac` | `config-rbac.yaml` | RBAC/permissions testing |

## Notes

- These configs are designed for local testing without external services
- Guest user identity is `user:development/guest` in development mode
- RBAC profile grants admin access to the guest user for testing

