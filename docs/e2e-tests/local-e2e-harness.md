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

Production-faithful — full plugin set and generated config, the same source CI uses:

```bash
# main branch -> :latest; release branches -> the matching :1.y tag
CATALOG_INDEX_IMAGE=quay.io/rhdh/plugin-catalog-index:latest \
  npx @red-hat-developer-hub/cli-module-install-dynamic-plugins install dynamic-plugins-root
```

Offline alternative (frontend plugins only; requires a reconciled workspace —
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
if `dynamic-plugins-root` is empty.

By default the run is scoped (via `grep`) to the one test verified green off-cluster so
far — the `guest-signin-happy-path` home-page test. Widen `testMatch`/`grep` as more
specs are validated (see "Known issues").

### Verified

With plugins populated, the legacy app renders the full production RHDH UI off-cluster
(branding, sidebar, and Quick Access from the dynamic home-page plugin). The existing
`guest-signin-happy-path` **home-page test passes unmodified** — confirming a dynamic
frontend plugin renders with no cluster.

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
- **`global-header` plugin mounting** still needs config sorting for the legacy harness;
  specs that navigate via the top-right profile dropdown depend on it.
- **Live-external-service specs** (real k8s cluster, GitHub org, Quay, Tekton, Keycloak)
  still need those services or mocks; this harness covers UI/plugin-rendering scenarios
  that don't require live external infra.
- **`janus-cli` / `backstage-cli`** live in the repo-root `node_modules/.bin`, which yarn
  does not surface for the `app`/`backend` workspaces, so the webServer commands invoke
  them directly with the root `.bin` prepended to `PATH`.
