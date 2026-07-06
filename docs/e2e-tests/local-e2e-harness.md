# Cluster-free local E2E harness

Spike deliverable for **RHIDP-13501 — E2E Test Optimization (Layer 4a)**, building on
the PoC in [PR #4523](https://github.com/redhat-developer/rhdh/pull/4523) and the
backend dynamic-plugin loader from RHIDP-13508.

## Goal

Run real Playwright E2E against RHDH **without** an OpenShift/Kubernetes cluster or
container images — a single `run` that boots the backend and the legacy frontend dev
server in-process and drives a browser against them.

The harness targets the legacy frontend (`packages/app`, Tier B): it is what RHDH ships
today, and **the existing Playwright specs already target it**, so they run unmodified.
Dynamic frontend plugins load through Scalprum exactly as in-cluster (the legacy
`scalprum-backend` serves the plugin config by default).

The guest-auth + in-memory-SQLite overlay `app-config.local-e2e.yaml` is layered on top
of `app-config.yaml`. Guest sign-in must be configured explicitly — the auth backend
otherwise rejects guest with _"you must … configure the auth backend to support guest
sign in."_

### 1. Populate `dynamic-plugins-root` (one-time)

Run the same script CI uses — it installs the harness plugin set
(`e2e-tests/local-harness/dynamic-plugins.yaml`) from the public OCI registry (ghcr)
via `install-dynamic-plugins` + skopeo, pinned to the same CLI version as CI. No
source build needed; works from a fresh clone. Requires skopeo (preinstalled in CI;
`brew install skopeo` on macOS):

```bash
./e2e-tests/local-harness/populate.sh
```

Alternatives:

- **Catalog index** — the index's `dynamic-plugins.default.yaml` references the core
  plugins by local `./dynamic-plugins/dist/…` paths that only exist after a source
  build, so on a fresh clone most plugins are skipped. Use only after building
  `dynamic-plugins` from source (main -> `:latest`; release branches -> the matching
  `:1.y` tag):

  ```bash
  CATALOG_INDEX_IMAGE=quay.io/rhdh/plugin-catalog-index:latest \
    npx @red-hat-developer-hub/cli-module-install-dynamic-plugins install dynamic-plugins-root
  ```

- **Offline from-source** (frontend plugins only; requires a reconciled workspace —
  see "Known issues"):

  ```bash
  yarn --cwd dynamic-plugins export-dynamic
  yarn --cwd dynamic-plugins copy-dynamic-plugins ../dynamic-plugins-root
  ```

### 2. Run

```bash
yarn --cwd e2e-tests e2e:legacy-local
```

Playwright (`playwright.legacy-local.config.ts`) boots the backend and the legacy app
dev server with `app-config.yaml` + `app-config.dynamic-plugins.yaml` +
`app-config.local-e2e.yaml`. A `globalSetup` first fails fast with the populate command
if `dynamic-plugins-root` has no plugins.

The run is scoped to tests tagged `@cluster-free` within the spec files allowlisted in
`testMatch`. To widen coverage, tag a validated test with `@cluster-free` and add its
spec file to `testMatch`; if the test needs extra plugins, add them (with their
`pluginConfig`) to `e2e-tests/local-harness/dynamic-plugins.yaml` and re-run
`populate.sh` (see "Known issues").

### Verified

With plugins populated, the legacy app renders the full production RHDH UI off-cluster
(branding, sidebar, global header, and Quick Access from the dynamic plugins). The
existing specs **pass unmodified**:

- `guest-signin-happy-path` — all three tests: home page (dynamic-home-page plugin),
  Settings and Sign-out (navigation via the global-header profile dropdown, using the
  plugin's canonical `pluginConfig` merged through the generated
  `dynamic-plugins-root/app-config.dynamic-plugins.yaml`, exactly as in-cluster).
- `learning-path-page` — renders from the static fallback data bundled with
  `packages/app`; the "References" sidebar group mirrors the CI menu customization via
  `app-config.local-e2e.yaml`.
- `instance-health-check` — `GET /healthcheck` against the frontend origin. The app dev
  server proxies `/healthcheck` to the backend (`proxy` field in
  `packages/app/package.json`), mirroring the single-origin production container where
  the backend serves both the app and the health endpoint.
- `smoke-test` — guest sign-in plus the home-page welcome heading (dynamic-home-page
  plugin); its readiness poll uses the same proxied `/healthcheck`.
- `home-page-customization` — all three tests. The CI home-page card customization
  (Placeholder/Markdown/Featured Docs/Random Joke/Top + Recently Visited, from
  `.ci/pipelines/resources/config_map/dynamic-plugins-config.yaml`) is mirrored in
  `app-config.local-e2e.yaml`; the Random Joke card fetches jokes from the public
  Official Joke API in the browser, so it needs outbound network access.

## CI

`.github/workflows/e2e-cluster-free.yaml` runs this harness on GitHub Actions in a
cluster-free phase: it installs deps + skopeo, populates `dynamic-plugins-root` via
`./e2e-tests/local-harness/populate.sh` (the harness plugin set from the public OCI
registry, ghcr), then runs `yarn e2e:legacy-local`. No cluster or container image is
built. It triggers on `e2e-tests/**` and `app-config*.yaml` changes; the scope can
widen to `packages/app/**` / `packages/backend/**` once it is proven stable.

## Why the legacy app, not app-next

The harness targets the legacy app because **dynamic frontend plugins do not load on
`packages/app-next` yet**: app-next's `dynamicFrontendFeaturesLoader()` fetches Module
Federation remotes from the backend, but that endpoint is no-op'd unless
`ENABLE_STANDARD_MODULE_FEDERATION=true`, and even then RHDH's exported dynamic frontend
plugins do not contain standard MF assets (see `packages/backend/src/index.ts`). Until
that lands upstream, app-next can only exercise core/static plugin UIs. An app-next
harness is tracked as a follow-up (RHIDP-13501 / spike RHIDP-15075).

## vs. rhdh-local

[`rhdh-local`](https://github.com/redhat-developer/rhdh-local) runs RHDH via
Podman/Docker Compose using the **production container image**. It is great for manual
feature testing with guest auth and UI-installed plugins, but it is **container-based**:
it requires a container runtime and pulling/running the RHDH image. For fast automated
E2E it is heavier than this in-process harness (no image pull, no container runtime —
just `run`), which is why this harness boots the dev servers directly instead.

## Known issues / limits

- **Workspace must be reconciled for the offline (from-source) populate path.** If
  `node_modules` is out of sync with `yarn.lock` (e.g. just after a rebase that changed
  dependency versions), backend dynamic-plugin builds fail with version-mismatch errors
  and yarn may not surface workspace bins. Run `yarn install` first. The
  `install-dynamic-plugins` populate path avoids building from source and is unaffected.
- **Re-run `populate.sh` after changing the harness plugin set.** The `pluginConfig`
  blocks in `e2e-tests/local-harness/dynamic-plugins.yaml` (e.g. the global-header
  mount points) only take effect through the generated
  `dynamic-plugins-root/app-config.dynamic-plugins.yaml`, which the webServer loads
  last. A stale populate leaves plugins loaded but unconfigured (the header renders
  empty).
- **Specs that need CI test data are not enabled yet.** `settings.spec.ts` asserts
  ownership entities ("Guest User, team-a") that come from catalog locations in the CI
  config map; `home-page-customization.spec.ts` needs the home-page card customization
  from `.ci/pipelines/resources/config_map/dynamic-plugins-config.yaml`. Enabling them
  means mirroring that data/config into the harness overlay.
- **Live-external-service specs** (real k8s cluster, GitHub org, Quay, Tekton, Keycloak)
  still need those services or mocks; this harness covers UI/plugin-rendering scenarios
  that don't require live external infra.
- **`janus-cli` / `backstage-cli`** live in the repo-root `node_modules/.bin`, which yarn
  does not surface for the `app`/`backend` workspaces, so the webServer commands invoke
  them directly with the root `.bin` prepended to `PATH`.
