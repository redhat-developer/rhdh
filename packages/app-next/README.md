# app-next

## Overview

This package contains the Red Hat Developer Hub (RHDH) frontend application built using Backstage's [new frontend system](https://backstage.io/docs/frontend-system/architecture/index). It is the NFS (New Frontend System) app shell used for local development and for testing plugins loaded via module federation.

The shell includes RHDH theme, sign-in, navigation sidebar, home page, global header, quickstart, and the dynamic feature loader. Optional plugins (for example notifications or signals) are **not** bundled here — they are deployed separately to `dynamic-plugins-root` and loaded at runtime.

## Prerequisites

- Dependencies installed from the repo root: `yarn install`
- A local config overlay such as `app-config.local.yaml` (not committed) that points the backend at this app and your local port
- Backend dynamic plugins copied or exported into `dynamic-plugins-root/` as needed for your scenario

## First-time setup

Build the app shell before starting the backend:

```bash
# from the repo root
EXPERIMENTAL_MODULE_FEDERATION=true yarn workspace app-next build
```

## Running locally

The recommended workflow serves `app-next` through the backend:

```bash
# from the repo root
yarn workspace backend start:next
```

`start:next` sets `APP_CONFIG_app_packageName=app-next` and `ENABLE_STANDARD_MODULE_FEDERATION=true` automatically (see `packages/backend/package.json`).

Wait for logs similar to:

```text
Listening on :7011
Serving static app content from .../packages/app-next/dist
```

Then open the app at your configured `app.baseUrl` (for example `http://localhost:7011`).

Rebuild `app-next` after changing files under `packages/app-next/`:

```bash
EXPERIMENTAL_MODULE_FEDERATION=true yarn workspace app-next build
```

Restart the backend to pick up a new build.

## Local configuration

Use `app-config.local.yaml` to override defaults from `app-config.yaml`. Typical settings for NFS local development:

```yaml
app:
  baseUrl: http://localhost:7011

backend:
  baseUrl: http://localhost:7011
  listen:
    port: 7011
  cors:
    origin: http://localhost:7011
    methods: [GET, HEAD, PATCH, POST, PUT, DELETE]
    credentials: true
  csp:
    connect-src:
      - "'self'"
      - 'http:'
      - 'https:'
      # Required when testing plugins that use WebSockets (for example signals):
      # - 'ws:'
      # - 'wss:'

dynamicPlugins:
  rootDirectory: dynamic-plugins-root
```

Quickstart, homepage, and global-header NFS extensions plus guest/GitHub auth providers are defined in `app-config.yaml`. For GitHub sign-in, set `GITHUB_OAUTH_APP_ID` and `GITHUB_OAUTH_APP_SECRET` in your environment (or in `app-config.local.yaml`) and ensure the OAuth App callback URL matches `<backend.baseUrl>/api/auth/github/handler/frame`.

Sign-in:

- **Guest** — enabled via `auth.providers.guest` in `app-config.yaml`.
- **GitHub** — offered on the sign-in page when `GITHUB_OAUTH_APP_ID` and `GITHUB_OAUTH_APP_SECRET` are configured.

## Verifying the shell

1. Sign in as guest (or with a configured provider).
2. Confirm the home page, sidebar (Home, Catalog, Scaffolder, Search), and global header render.
3. Open the extension visualizer at `/visualizer/tree` and confirm core extensions load (for example `page:home`, `page:catalog`).

Loading additional NFS plugins via module federation is documented separately (see repo docs for exporting plugins to `dynamic-plugins-root`).

## Standalone frontend development

You can run the frontend dev server without the full backend workflow:

```bash
yarn workspace app-next start
```

This uses `app-config.yaml` only and does not enable the same module federation backend integration as `start:next`.

## Other commands

- `yarn build` — production build (module federation enabled via `package.json` script)
- `yarn test` — run tests
- `yarn lint` — lint checks
- `yarn clean` — remove build artifacts
- `yarn tsc` — typecheck

## Architecture

Static features registered in `src/App.tsx`:

| Module | Purpose |
|--------|---------|
| `rhdhThemeModule` | RHDH branding and theme |
| `signInModule` | Sign-in page (guest + GitHub) |
| `navModule` | Sidebar navigation |
| `homePlugin` / `homePageModule` | Home page and RHDH homepage layout |
| `globalHeaderPlugin` | Top navigation bar (loaded after MF remotes) |
| `quickstartPlugin` | Quickstart drawer and content |
| `dynamicFrontendFeaturesLoader()` | Loads NFS plugins from `dynamic-plugins-root` |

Plugin load order matters: `dynamicFrontendFeaturesLoader()` runs before static global header so the static header wins if the same plugin is also present as an MF remote.

## Related documentation

- [Backstage new frontend system](https://backstage.io/docs/frontend-system/architecture/index)
- Exporting and testing NFS plugins via module federation — see companion doc in this repo (Part 2)
