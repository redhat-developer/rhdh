# Using backstage-cli with RHDH

The `@backstage/cli auth` command provides CLI-based authentication to a Backstage instance using OAuth2 with PKCE. This enables programmatic access to catalog entities, scaffolder actions, and other Backstage APIs without a browser session.


## Prerequisites

### Enable the auth plugin

The `backstage-cli auth` flow requires the `@backstage/plugin-auth` frontend plugin to serve the OAuth2 consent page at `/oauth2/authorize/:sessionId`. RHDH does not include this plugin by default.

Install it as a dynamic plugin from the [rhdh-plugin-export-overlays](https://github.com/redhat-developer/rhdh-plugin-export-overlays) registry:

```yaml
# dynamic-plugins.yaml
plugins:
  - package: "oci://ghcr.io/redhat-developer/rhdh-plugin-export-overlays/backstage-plugin-auth:bs_1.49.4__0.1.6"
    disabled: false
    pluginConfig:
      dynamicPlugins:
        frontend:
          backstage.plugin-auth:
            dynamicRoutes:
              - path: /oauth2/*
                importName: Router
```

Replace `<tag>` with the appropriate version tag from the registry.

### Enable the OAuth2 server endpoints

Add the following to your `app-config.local.yaml`:

```yaml
auth:
  experimentalClientIdMetadataDocuments:
    enabled: true
  experimentalRefreshToken:
    enabled: true
```

This enables the backend OAuth2 endpoints.


## Running backstage-cli

The CLI is published as `@backstage/cli` on npm. But it can't be run outside of a Backstage or RHDH project directory. See [standalone usage](#standalone-usage) for more information.  Run it from within a Backstage or RHDH project directory:

```bash
npx @backstage/cli auth login --backend-url <RHDH_URL>
npx @backstage/cli auth list
npx @backstage/cli actions list
```

### Standalone usage

`@backstage/cli` bundles build tooling alongside the `auth` and `actions` subcommands. The package declares optional peer dependencies on `jsdom@^27.1.0` and `jest-environment-jsdom`, but `jest-environment-jsdom` pulls in `jsdom@29.x` as a regular dependency. npm 7+ auto-resolves peer dependencies and fails with `ERESOLVE` when it can't satisfy both `^27.1.0` and `29.x` at the same level — even though these dependencies are optional and never used by the `auth` or `actions` commands.

Inside a Backstage project this works because the project lockfile already has compatible versions resolved. To run standalone, set `NPM_CONFIG_LEGACY_PEER_DEPS=true` to tell npm to skip auto-installing peer dependencies (the pre-npm 7 behavior):

```bash
NPM_CONFIG_LEGACY_PEER_DEPS=true npx -y @backstage/cli auth login --backend-url <RHDH_URL>
```

Or define a shell alias for convenience:

```bash
alias backstage-cli='NPM_CONFIG_LEGACY_PEER_DEPS=true npx -y @backstage/cli'
```

Then use it from any directory without a Backstage checkout:

```bash
backstage-cli auth login --backend-url http://localhost:7007
backstage-cli auth list
backstage-cli actions sources add catalog
backstage-cli actions list
```

## Troubleshooting

### 404 on /oauth2/authorize

The `@backstage/plugin-auth` frontend plugin is not loaded. Verify the dynamic plugin configuration and check pod logs for plugin loading errors.

