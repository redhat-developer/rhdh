# Cluster-free local E2E harness

Spike deliverable for **RHIDP-13501 — E2E Test Optimization (Layer 4a)**, building on
the PoC in [PR #4523](https://github.com/redhat-developer/rhdh/pull/4523) and the
backend dynamic-plugin loader from RHIDP-13508.

## Goal

Run real Playwright E2E against RHDH **without** an OpenShift/Kubernetes cluster or
container images — a single `run` that boots the backend and the NFS frontend dev
server in-process and drives a browser against them.

The guest-auth + in-memory-SQLite overlay `app-config.local-e2e.yaml` is layered on top
of `app-config.yaml`. Guest sign-in must be configured explicitly — the auth backend
otherwise rejects guest with _"you must … configure the auth backend to support guest
sign in."_

### 1. Populate `dynamic-plugins-root` (one-time)

Run the same script CI uses — it installs the harness plugin set
(`e2e-tests/local-harness/dynamic-plugins.yaml`) from the public OCI registry (quay.io)
via `install-dynamic-plugins` + skopeo, with `{{inherit}}` resolved against the full
`dynamic-plugins.default.yaml` at the repo root (same as Helm/CI `includes`). Set
`CATALOG_INDEX_IMAGE` to extract the full catalog DPDY from a catalog-index OCI image
instead. Pinned to the same CLI version as CI. No source build needed; works from a
fresh clone. Requires skopeo (preinstalled in CI; `brew install skopeo` on macOS):

```bash
./e2e-tests/local-harness/populate.sh
```

Extract from a specific catalog index image (overrides repo-root DPDY with the full
catalog extracted from that image):

```bash
CATALOG_INDEX_IMAGE=quay.io/rhdh/plugin-catalog-index:2.0 ./e2e-tests/local-harness/populate.sh
```

`populate.sh` takes an optional install-config path as its first argument
(default: the curated harness set above). The plugin sanity check drives that
hook through `populate-catalog-index.sh`, which generates a config enabling every
package the catalog index declares — see "Plugin Sanity Check" in
[`e2e-tests/README.md`](../../e2e-tests/README.md). Both flavors share
`populate.sh` for the install itself.

Alternatives:

- **Catalog index** — installs the full index plugin set instead of the curated one.
  The index still references a few core plugins by local `./dynamic-plugins/dist/…`
  paths that only exist after a source build, and the CLI skips those; everything
  else resolves from the public registries. Use `populate-catalog-index.sh`, which
  also records the breadcrumb the plugin sanity check asserts against:

  ```bash
  CATALOG_INDEX_IMAGE=quay.io/rhdh/plugin-catalog-index:next \
    ./e2e-tests/local-harness/populate-catalog-index.sh
  ```

Alternatives (continued):
- **Offline from-source** (frontend plugins only; requires a reconciled workspace —
  see "Known issues"):

  ```bash
  yarn --cwd dynamic-plugins export-dynamic
  yarn --cwd dynamic-plugins copy-dynamic-plugins ../dynamic-plugins-root
  ```

### 2. Run

```bash
yarn --cwd e2e-tests e2e:local
```

Playwright (`playwright.local.config.ts`) boots the backend and the NFS app dev server
with `app-config.yaml` + `app-config.dynamic-plugins.yaml` +
`app-config.local-e2e.yaml`. A `globalSetup` first fails fast with the populate command
if `dynamic-plugins-root` has no plugins.

The run is scoped to tests tagged `@cluster-free-capable` within the spec files
allowlisted in `testMatch`. To widen coverage, tag a validated test with
`@cluster-free-capable` and add its spec file to `testMatch`; if the test needs
extra plugins, add them (with their `pluginConfig`) to
`e2e-tests/local-harness/dynamic-plugins.yaml` and re-run `populate.sh` (see
"Known issues").

### Verified

With plugins populated, the NFS app renders the full production RHDH UI off-cluster
(branding, sidebar, the home-page widgets from the dynamic plugins, and the full
GlobalHeader — CompanyLogo, Search, StarredDropdown, ApplicationLauncherDropdown,
HelpDropdown, NotificationButton, and ProfileDropdown all render — see "Known issues"
for how that's wired).

- `guest-signin-happy-path` — the `@cluster-free-capable` test (home page: Welcome heading,
  Search and Starred Entities, all dynamic-home-page-plugin widgets, plus Settings and
  Sign-out via the GlobalHeader's profile menu). A fourth, untagged test in the same
  file exercises Quick Access against the real `/developer-hub` proxy; it only runs in
  the full cluster-based CI suite (see "Known issues").
- `learning-path-page` — navigates via the NFS sidebar flat nav to `/learning-paths`
  and renders from the static fallback data bundled with the app. See
  `plugins/frontend/sidebar` for the same sidebar entry.
- `instance-health-check` — `GET /healthcheck` against the frontend origin. The app dev
  server proxies `/healthcheck` to the backend (`proxy` field in
  `packages/app/package.json`), mirroring the single-origin production container where
  the backend serves both the app and the health endpoint.
- `smoke-test` — guest sign-in plus the home-page welcome heading (dynamic-home-page
  plugin); its readiness poll uses the same proxied `/healthcheck`.
- `home-page-customization` — the Quick Access, Featured Docs, Top Visited, and
  Recently Visited widgets, using the `home-page-layout:home/dynamic-homepage-layout`
  `app.extensions` customization mirrored from
  `.ci/pipelines/resources/config_map/dynamic-plugins-config.yaml` into
  `app-config.local-e2e.yaml`. NFS home-page cards are a fixed set of built-in widgets
  (`home-page-widget:home/*`) — the legacy Placeholder/Markdown/Random Joke mount-point
  cards have no NFS equivalent and are no longer asserted. Its `@cluster-free-capable` "Quick
  Access" assertion only checks the card's title text, not real link data (see "Known
  issues" for why); the file's other, untagged "Verify Customized Quick Access" test
  covers the real link data and only runs in full CI.
- `plugins/frontend/sidebar` — the `@cluster-free-capable` tests verify flat-nav behavior:
  Docs and Learning Paths sidebar items navigate to the expected pages (NFS
  `PageBlueprint` title for TechDocs: "Docs", not the legacy OFS `pageWrapper.title`
  "Documentation"). NFS's sidebar (`packages/app/src/modules/nav/Sidebar.tsx`) is a
  fixed, code-defined flat nav with no config-driven nested-group equivalent of the
  legacy References/Favorites `menuItems`. The Docs test stops at the index page —
  this harness's catalog has no `techdocs-ref`-annotated entities (see "Known issues"),
  so there's nothing to click into. The file's other, untagged "Verify Docs entity
  page renders real content" test opens a real entity's docs and checks for actual
  content; it only runs in full CI, where `catalog-entities/components/showcase.yaml`/
  `community-plugins.yaml` provide real `techdocs-ref` entities.
- `plugins/user-settings-info-card` — the CI `buildInfo` card customization ("RHDH
  Build info") mirrored in the overlay. Reaches the Settings page via the same
  `goToSettingsPage()` helper `settings.spec.ts` uses, through the GlobalHeader's
  profile menu.
- `settings.spec.ts` — language toggle (needs `api:app/app-language.availableLanguages`
  in `app.extensions`, not just `i18n.locales`), French label switching, pin-sidebar
  toggle, and identity-card ownership ("Guest User, team-a"). NFS sidebar page titles
  stay in upstream English ("Home") even after switching AppLanguageApi to French —
  only GlobalHeader chrome translates; the final assertion checks "Home", not
  `menuItem.home` ("Accueil").

Not enablable yet:

- `plugins/application-provider` and `plugins/application-listener` — the
  application-provider-test / application-listener-test OCI plugins (pinned in
  `values_showcase.yaml` for cluster-based CI) only publish an OFS ("." Module
  Federation) entry point, no NFS/alpha extensions. `application/provider` and
  `application/listener` are rendered exclusively by `packages/app-legacy`'s
  `ApplicationProvider.tsx`/`ApplicationListener.tsx`, which the NFS `packages/app` has
  no equivalent for — so neither spec can currently pass here. Not installed in the
  harness; re-add once NFS support exists for either the fixture plugins or a generic
  provider/listener renderer in `packages/app`.
- `plugins/licensed-users-info-backend` — the
  `licensed-users-info-backend` plugin is not published to the overlays OCI registry
(ghcr) and only exists as a `./dynamic-plugins/dist` source build.

## CI

`.github/workflows/e2e-cluster-free.yaml` runs this harness on GitHub Actions in a
cluster-free phase: it installs deps + skopeo, populates `dynamic-plugins-root` via
`./e2e-tests/local-harness/populate.sh` (full repo-root `dynamic-plugins.default.yaml`
+ harness plugin set from quay.io), then runs `yarn e2e:local`. No cluster or container
image is built. It triggers on `e2e-tests/**` and `app-config*.yaml` changes; the scope
can widen to `packages/app/**` / `packages/backend/**` once it is proven stable.

## NFS frontend (`packages/app`)

The harness targets the NFS frontend (`packages/app`). The backend serves standard
Module Federation assets by default, so dynamic frontend plugins load via Module
Federation remotes from the backend (see `packages/backend/src/index.ts` and
`playwright.local.config.ts`).

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
- **Re-run `populate.sh` after changing the harness plugin set.** Any `pluginConfig`
  blocks in `e2e-tests/local-harness/dynamic-plugins.yaml` only take effect through the
  generated `dynamic-plugins-root/app-config.dynamic-plugins.yaml`, which the webServer
  loads last. A stale populate leaves plugins loaded but unconfigured/outdated.
- **Live-external-service specs** (real k8s cluster, GitHub org, Quay, Tekton, Keycloak)
  still need those services or mocks; this harness covers UI/plugin-rendering scenarios
  that don't require live external infra.
- **`backstage-cli`** lives in the repo-root `node_modules/.bin`, which yarn
  does not surface for the `app`/`backend` workspaces, so the webServer commands invoke
  it directly with the root `.bin` prepended to `PATH`.
- **`VisitsStorageApi` 404s under this config, pre-dating NFS.** `app-config.local-e2e.yaml`
  sets `userSettings.persistence: browser` (added in `#4020`, before the NFS migration,
  to opt CI out of database storage, and mirrored in the CI ConfigMap), which means
  `@backstage/plugin-user-settings-backend` is never loaded (see
  `packages/backend/src/modules/userSettings.ts`). `VisitsStorageApi` calls the backend
  regardless, so `/api/user-settings/multiget`/`/api/user-settings/buckets/...` 404 —
  in a production build that's just a background error, but under this harness's dev
  server the unhandled rejection trips webpack's react-refresh error overlay (a
  full-screen transparent `<iframe id="react-refresh-overlay">`) which then intercepts
  every subsequent click for the rest of the test. Because of that, `app-config.local-e2e.yaml`
  deliberately does **not** enable `app-root-element:home/visit-listener` (unlike the CI
  ConfigMap) — it's the extension that calls `VisitsStorageApi.save()` on every route
  change. `api:home/visits` is still enabled so the home-page-customization "Top
  Visited"/"Recently Visited" widgets keep rendering (just always empty, since nothing
  ever records a visit here).
- **Quick Access needs a CI-only proxy target.** The Quick Access widget calls
  `GET /api/proxy/developer-hub`
  ([`QuickAccessApiClient`](https://github.com/redhat-developer/rhdh-plugins/blob/main/workspaces/homepage/plugins/homepage/src/api/QuickAccessApiClient.ts)).
  In cluster-based CI that proxies to `${DH_TARGET_URL}`, a companion service
  (`test-backstage-customization-provider`) deployed only inside the CI OpenShift
  cluster (`.ci/pipelines/resources/config_map/app-config-rhdh-rbac.yaml`,
  `.ci/pipelines/utils.sh`). This harness has no such target, so the request 404s and
  the widget renders `"Error: Could not fetch data."` instead of real content. Real
  Quick Access link-data coverage (`verifyQuickAccess(...)`) only runs in full CI, via
  the untagged tests in `guest-signin-happy-path.spec.ts` and
  `home-page-customization.spec.ts`; the `@cluster-free-capable` tests only check that the
  Quick Access card renders (title text), not its content.
- **GlobalHeader (RESOLVED).** Used to render only CompanyLogo and the header
  SearchComponent, breaking any test that navigates to Settings via the profile menu
  (`SettingsPage.open()` → `goToSettingsPage()` → `getGlobalHeader()` in
  `playwright/utils/ui-helper/interaction.ts`, which locates the header via
  ProfileDropdown's `KeyboardArrowDownOutlinedIcon` testid). Two issues stacked here,
  both now fixed:
  - The harness had pinned an outdated ghcr overlays build
    (`bs_1.49.4__1.21.6`, predating RHDH's current Backstage 1.52.0) driven through the
    legacy OFS `dynamicPlugins.frontend.*.mountPoints` config bridge — switching to the
    `{{inherit}}`-resolved `quay.io` build fixed the stale-build half of it.
  - More fundamentally, the mountPoints bridge was the wrong mechanism entirely: the
    global-header plugin ships its own native NFS extensions
    (`gh-component:global-header/*`, `gh-menu-item:global-header/*`, defined in
    `rhdh-plugins/workspaces/global-header/plugins/global-header/src/extensions/blueprints.tsx`)
    which are enabled by default and already reproduce every mountPoint the old config
    hand-rolled (CompanyLogo, Search, StarredDropdown, ApplicationLauncherDropdown,
    HelpDropdown, NotificationButton, ProfileDropdown, the Settings/My profile/Logout
    menu items, etc. — see `.../src/plugin.ts` and `.../src/defaults/`). `pluginConfig`
    for the plugin was dropped entirely from `e2e-tests/local-harness/dynamic-plugins.yaml`;
    only its `app-root-wrapper:app/global-header` wrapper and
    `translation:app/global-header-translations` module needed explicit `app.extensions`
    entries (they attach to the core `app` plugin, which isn't auto-enabled the way
    plugin-scoped extensions are) — see `app-config.local-e2e.yaml`.
  - Fixing the header surfaced the `VisitsStorageApi`/react-refresh-overlay click-blocker
    above (previously masked because no test's click never reached the header).
- **Language toggle needs `api:app/app-language`, not just `i18n.locales` (RESOLVED).**
  `UserSettingsLanguageToggle` hides itself when NFS `AppLanguageApi` reports
  `languages.length <= 1`. `AppLanguageApi` reads `availableLanguages` from the
  `api:app/app-language` extension config — `i18n.locales` alone does nothing. Both
  `app-config.local-e2e.yaml` and
  `.ci/pipelines/resources/config_map/dynamic-plugins-config.yaml` now set
  `availableLanguages` to match their `i18n.locales` lists. The test assertion was also
  updated: Language lives in the same Appearance `<List>` as Theme and Pin Sidebar, so
  `verifyLanguageToggleList()` now checks the Language listitem exists rather than
  requiring it to be the page's first/only list.
- **TechDocs index heading is "Docs", not "Documentation" (RESOLVED).** NFS
  `@backstage/plugin-techdocs` alpha sets `PageBlueprint` `title: 'Docs'` for `/docs`.
  "Documentation" was only the legacy OFS `TechDocsPageWrapper` `pageWrapper.title`
  translation. `sidebar.spec.ts`'s cluster-free test now asserts `verifyDocsHeading()`
  ("Docs"); "Documentation available in …" still appears on entity reader pages and is
  covered by the file's untagged full-CI test.
- **TechDocs index is always empty in this harness.** The catalog only loads
  `e2e-tests/local-harness/guest-ownership-entities.yaml` (a plain User + Group), which
  has no `backstage.io/techdocs-ref` annotation, so `/docs` (TechDocsIndexPage) always
  shows "No documents to show". `plugins/frontend/sidebar.spec.ts`'s `@cluster-free-capable`
  test only verifies reaching that index page; its untagged "Verify Docs entity page
  renders real content" test needs a real `techdocs-ref` entity and only runs in full
  CI (see "Verified" above).
