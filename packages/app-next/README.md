# app-next

## Overview

This package is the Red Hat Developer Hub (RHDH) **NFS** (New Frontend System) app shell. It keeps core Backstage plugins that still need to ship with the app, plus a Module Federation feature loader for remotes from `dynamic-plugins-root`.

Most RHDH product UX loads as **dynamic plugins** (sign-in via **app-auth**, global-header, quickstart, …) so those pieces stay swappable — see [`dynamic-plugins.example.yaml`](./dynamic-plugins.example.yaml).

**Homepage exception (temporary):** published OCI homepage overlays are still OFS-shaped for NFS, so this shell statically mounts RHDH `homePageModule` so `/` works for local NFS verification (including homepage cards such as unread notifications). Prefer loading homepage via MF when an NFS-capable overlay exists, or use the [local export](#local-nfs-export-homepage--theme) path below.

## Prerequisites

- Dependencies installed from the repo root: `yarn install`
- A local config overlay such as `app-config.local.yaml` (not committed)
- `skopeo` available on your PATH (for pulling OCI plugin overlays)
- Dynamic plugins installed into `dynamic-plugins-root/` for the UX you want to test

## First-time setup

### 1. Build the app shell

```bash
# from the repo root
EXPERIMENTAL_MODULE_FEDERATION=true yarn workspace app-next build
```

### 2. Install default dynamic plugins

Populate `dynamic-plugins-root` from the example plugin set (OCI overlays via `install-dynamic-plugins`). Requires `skopeo`:

```bash
# from the repo root
cp packages/app-next/dynamic-plugins.example.yaml dynamic-plugins.yaml
npx -y @red-hat-developer-hub/cli-module-install-dynamic-plugins@0.2.0 \
  install dynamic-plugins-root
```

- Uncomment additional entries in [`dynamic-plugins.example.yaml`](./dynamic-plugins.example.yaml) (sourced from [default.packages.yaml](https://github.com/redhat-developer/rhdh-plugin-export-overlays/blob/main/default.packages.yaml)) before copying if you need more plugins.
- Re-run the install when you change the enabled plugin list.
- Leave homepage/theme OCI entries **commented** — the shell already provides NFS homepage statically; OCI tags would overwrite a local homepage export with OFS assets.

### 3. Local config for homepage

Put NFS `app.extensions` in `app-config.local.yaml` only (not shared `app-config.yaml`):

```yaml
app:
  baseUrl: http://localhost:7007
  extensions:
    - page:home:
        config:
          path: /
    - api:home/visits: true
    - app-root-element:home/visit-listener: true
    - home-page-layout:home/dynamic-homepage-layout:
        config:
          customizable: true
    - app-root-wrapper:app/global-header: true
    - app-root-wrapper:app/drawer: true
    - app-drawer-content:quickstart/quickstart: true

backend:
  baseUrl: http://localhost:7007
  listen:
    port: 7007
  cors:
    origin: http://localhost:7007
    methods: [GET, HEAD, PATCH, POST, PUT, DELETE]
    credentials: true

auth:
  environment: development
  providers:
    guest: {}

dynamicPlugins:
  rootDirectory: dynamic-plugins-root
```

**Sign-in:** load **app-auth** (and typically **app-integrations**) via the example YAML. Configure providers under `auth.providers` in your local overlay.

## Running locally

### Frontend iteration (hot reload)

```bash
yarn workspace app-next start
```

### Full stack with Module Federation

```bash
yarn workspace backend start:next
```

`start:next` sets `APP_CONFIG_app_packageName=app-next` and `ENABLE_STANDARD_MODULE_FEDERATION=true` (see `packages/backend/package.json`). The backend serves `packages/app-next/dist` from its own port (default **7007** unless overridden in `app-config.local.yaml`).

Rebuild the shell after changing files under `packages/app-next/` when using `start:next`:

```bash
EXPERIMENTAL_MODULE_FEDERATION=true yarn workspace app-next build
```

## Verifying the shell

1. With app-auth installed, sign in (guest when `auth.environment: development` and `auth.providers.guest` are set).
2. Open `/` — RHDH homepage layout/widgets should render (`homePlugin` + static `homePageModule`).
3. With global-header / quickstart installed, confirm those surfaces render.
4. Open `/visualizer/tree` and confirm core extensions (for example `page:catalog`, `page:home`) load.

## Testing homepage cards (e.g. unread notifications)

NFS homepage cards are **not** OFS `home.page/cards` mount points. They register as `HomePageWidgetBlueprint` extensions on `page:home`.

The unread-notifications card lives in a local/patched `@backstage/plugin-notifications` as `notificationsHomeModule` (MF expose `notifications-home-module`). Stock npm / RHDH wrapper OCI builds do **not** include that widget yet.

### A. Keep NFS homepage in the shell (default)

No change needed: `App.tsx` already includes `homePlugin` + `homePageModule`.

### B. Export notifications (+ signals) into `dynamic-plugins-root`

From a Backstage checkout that contains the NFS home widget (exposes `.`, `alpha`, and `notifications-home-module`):

```bash
# Frontend — prefer package bundle / export that generates MF assets
cd /path/to/backstage/plugins/notifications
yarn build --role frontend-dynamic-container
# or: npx backstage-cli package bundle --output-destination <rhdh>/dynamic-plugins-root
# Ensure the result lands under:
#   <rhdh>/dynamic-plugins-root/backstage-plugin-notifications-dynamic
# (or equivalent) with dist/mf-manifest.json exposing notifications-home-module

# Also export signals (frontend + backend) if not already present — live updates
# depend on them. Use your usual wrapper/export flow into dynamic-plugins-root.
```

Sanity check:

```bash
python3 -c "import json; m=json.load(open('dynamic-plugins-root/backstage-plugin-notifications-dynamic/dist/mf-manifest.json')); print([e['name'] for e in m['exposes']])"
# expect: ['.', 'alpha', 'notifications-home-module']
```

Backend notifications (and signals backend) must also be available under `dynamic-plugins-root` for the API to work.

### C. Enable the widget in `app-config.local.yaml`

```yaml
app:
  extensions:
    - home-page-widget:home/unread-notifications: true
    # optional layout (widget name = HomePageWidgetBlueprint params.name)
    - home-page-layout:home/dynamic-homepage-layout:
        config:
          customizable: true
          widgetLayout:
            UnreadNotifications:
              priority: 50
              breakpoints:
                xl: { w: 6, h: 4 }
```

Do **not** rely on OFS `dynamicPlugins.frontend.backstage.plugin-notifications.mountPoints` for `app-next` — that path is legacy Scalprum only.

### D. Rebuild and verify

```bash
EXPERIMENTAL_MODULE_FEDERATION=true yarn workspace app-next build
yarn workspace backend start:next
```

In `/visualizer/tree`, confirm:

- `home-page-widget:home/unread-notifications`
- `api:notifications/notifications` (or equivalent notifications API)
- `page:home`

Then open `/` and confirm the unread notifications card on the grid.

## Local NFS export (homepage & theme)

Use this when you need to iterate on homepage/theme from [rhdh-plugins](https://github.com/redhat-developer/rhdh-plugins) as MF remotes (closer to the long-term DP-first model). Full NFS plugin migration is tracked separately; this is the local workaround until overlays ship NFS `alpha`.

**Prerequisite — `alpha` must default-export a `FrontendFeature`.** Backstage’s MF remote build only exposes non-`.` package entry points (including `./alpha`) when the default export is a frontend feature. Homepage/theme currently ship NFS pieces as **named** exports only (`homePageModule`, `rhdhThemeModule`), so a plain export produces expose `.` only.

In your local `rhdh-plugins` tree, add a temporary default (or land this in the NFS migration epic):

```ts
// workspaces/homepage/plugins/homepage/src/alpha/index.ts
export default homePageModule;

// workspaces/theme/plugins/theme/src/alpha/index.ts
export default rhdhThemeModule;
```

Then:

```bash
# from rhdh-plugins (install/build the workspace once if needed)
cd workspaces/homepage/plugins/homepage
yarn build
npx -y @red-hat-developer-hub/cli plugin export --clean --dev \
  --dynamic-plugins-root "$HOME/redhat/rhdh/dynamic-plugins-root"

cd ../../../theme/plugins/theme
yarn build
npx -y @red-hat-developer-hub/cli plugin export --clean --dev \
  --dynamic-plugins-root "$HOME/redhat/rhdh/dynamic-plugins-root"
```

**Sanity check:**

```bash
python3 -c "import json; m=json.load(open('dynamic-plugins-root/red-hat-developer-hub-backstage-plugin-homepage/dist/mf-manifest.json')); print([e['name'] for e in m['exposes']])"
# expect: ['.', 'alpha']
```

**When using the local homepage remote:** remove the static `homePageModule` import from `src/App.tsx` (keep `homePlugin`), rebuild app-next, and restart `start:next`. Keep homepage/theme OCI entries commented so install does not overwrite your export.

## Other commands

- `yarn build` — production build (module federation enabled via `package.json` script)
- `yarn test` — run tests
- `yarn lint` — lint checks
- `yarn clean` — remove build artifacts
- `yarn tsc` — typecheck

## Architecture

Static features in `src/App.tsx`:

| Module | Purpose |
|--------|---------|
| `navModule` | Sidebar navigation layout |
| `appVisualizerPlugin` | Extension visualizer (`/visualizer`) |
| `catalogPlugin` / `homePlugin` / `scaffolderPlugin` / `searchPlugin` / `userSettingsPlugin` | Core Backstage plugins (`home` is required host for RHDH homepage + card widgets) |
| `homePageModule` | **Temporary** RHDH homepage layout/widgets — see below |
| `appDrawerModule` | Drawer host for DP content (e.g. quickstart); no app-react overlay yet |
| `rhdhDynamicFrontendFeaturesLoader()` | Temporary helper — loads NFS remotes from `dynamic-plugins-root` |

### Temporary: static `homePageModule`

Published OCI homepage overlays are still **OFS-shaped** (MF expose is only `.`, default is not a `FrontendFeature`). The NFS loader skips them.

Until an NFS-capable overlay ships (or you use a [local NFS export](#local-nfs-export-homepage--theme)):

1. Keep `@backstage/plugin-home` (`homePlugin`) in the shell — host for `pluginId: 'home'` widgets.
2. Keep `homePageModule` from `@red-hat-developer-hub/backstage-plugin-homepage/alpha` static so `/` works for team verification without patching `rhdh-plugins`.
3. Leave homepage (and theme) OCI entries commented in [`dynamic-plugins.example.yaml`](./dynamic-plugins.example.yaml).

**Removal:** when a published NFS overlay works via MF, delete the static `homePageModule` import, enable the OCI entry, and rely on `rhdhDynamicFrontendFeaturesLoader`.

### Temporary helper: `rhdhDynamicFrontendFeaturesLoader`

**Location:** [`src/modules/dynamicFeatures/rhdhDynamicFrontendFeaturesLoader.ts`](./src/modules/dynamicFeatures/rhdhDynamicFrontendFeaturesLoader.ts)

**Why it exists:** The stock Backstage [`dynamicFrontendFeaturesLoader`](https://github.com/backstage/backstage/tree/master/packages/frontend-dynamic-feature-loader) only registers each remote module’s **`default`** export. Some RHDH NFS packages still put required shell pieces in **named** exports (for example global-header: default `globalHeaderPlugin` plus named `globalHeaderModule` for the `AppRootWrapper`). Without the helper, those named features never mount.

The helper keeps the same remotes discovery/MF flow, but also registers every loadable named `FrontendPlugin` / `FrontendModule` export (deduped by reference). That also picks up notifications’ `notifications-home-module` expose when present.

**Follow-up / removal criteria:** When published OCI overlays default-export the NFS features that matter (or otherwise make a single `default` sufficient for each remote), switch `App.tsx` back to:

```ts
import { dynamicFrontendFeaturesLoader } from '@backstage/frontend-dynamic-feature-loader';
```

Then delete `src/modules/dynamicFeatures/` (loader + `collectLoadableFeatures` helper and its unit test).

## Related documentation

- [Backstage new frontend system](https://backstage.io/docs/frontend-system/architecture/index)
- [app-defaults: app-auth / app-integrations](https://github.com/redhat-developer/rhdh-plugins/tree/main/workspaces/app-defaults) — intended to load dynamically into RHDH, not statically into this shell
- [rhdh-plugin-export-overlays default.packages.yaml](https://github.com/redhat-developer/rhdh-plugin-export-overlays/blob/main/default.packages.yaml)
