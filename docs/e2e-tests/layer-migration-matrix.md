# E2E → Lower-Layer Migration Matrix (Phase 1)

**Epic**: RHIDP-13501 — [Test Strategy] E2E Test Optimization (Optional)
**Story**: RHIDP-15076 — Identify E2E specs supplementable by Layer 3 / cluster-free harness (Phase 1)
**Author**: Gustavo Lira e Silva
**Date**: 2026-06-26 (updated 2026-07-07 with L4a harness expansion results)
**Status**: DRAFT — promote once the batches below are groomed into RHIDP-13528/13529

> **This is an _additive_ analysis, not a removal plan.** Per the epic, no E2E spec
> has to be deleted. The goal is to identify where a faster Layer 1/2/3 (or cluster-free
> Layer 4a) test could provide the same signal earlier and cheaper, so the two can
> coexist and we _optionally_ retire the slow path later (tracked separately in
> RHIDP-13236).

## Layer definitions used

| Layer                    | Scope                                                            | Tooling                               | Cluster | Typical time |
| ------------------------ | ---------------------------------------------------------------- | ------------------------------------- | ------- | ------------ |
| **L1** Unit              | Pure functions / logic                                           | Jest/Vitest                           | no      | ms–s         |
| **L2** Integration       | Backend module + plugin API, mocked external deps                | `startTestBackend` + supertest        | no      | s            |
| **L3** Component         | React component/page with a test harness                         | RTL + `startTestBackend` / dev server | no      | s–min        |
| **L4a** E2E cluster-free | Full app, no managed infra (real GitHub/IdP may still be needed) | Playwright + local harness            | no      | min          |
| **L4b** E2E full         | Real OCP/K8s, managed DBs, real IdPs                             | Playwright + cluster                  | **yes** | min–h        |

**Migration rule of thumb**

- _Renders UI, no cluster, no real external service_ → **L3**
- _Backend API only, no cluster_ → **L2** (or **L1** for pure logic)
- _Needs full app but only GitHub/IdP (no cluster infra)_ → **L4a** now; **L2/L3** only if the external call is mocked
- _Needs real cluster / managed DB / real IdP / ConfigMap reload_ → **stays L4b**

## Update 2026-07-02 — L4a harness validation (RHIDP-15075, PR #5005)

(Spec numbers refer to the summary matrix below.)

As of this update, the cluster-free harness **ran 2 specs (4 test cases) green in
CI** (~3.5 min GitHub Actions job, no cluster, no image build): the full `guest-signin-happy-path`
spec (#4 — home page, Settings, Sign-out: 3 test cases) and `learning-path-page` (#6). Two findings that
change the cost picture for the remaining candidates:

- **The global-header blocker is solved.** The repo's static
  `app-config.dynamic-plugins.yaml` only mounts the bare `GlobalHeader` with no
  children; the harness now installs the plugin from OCI with its canonical
  `pluginConfig` and loads the generated
  `dynamic-plugins-root/app-config.dynamic-plugins.yaml` last — the same file/merge
  order as the production container. Profile-dropdown navigation (used by #4, #5 and
  others) works off-cluster. The pattern generalizes to any plugin whose config is not
  in the repo's static file.
- **CI-configmap customizations mirror cheaply.** The "References" menu nesting from
  `.ci/pipelines/resources/config_map/dynamic-plugins-config.yaml` was mirrored in
  `app-config.local-e2e.yaml` with a few object-merge keys — the same approach covers
  the sidebar (#8), build-info card (#9), and home-page cards (#7) configs.

A fresh dependency scan (2026-07-02) of all 29 specs on `main` confirms the L4b bucket
below is exactly the CLUSTER-BOUND set (pod-log scraping, ConfigMap patch + restart,
port-forward, managed DBs, full `RHDHDeployment` lifecycle). Running a spec on the L4a
harness does not change its **target layer** — L4a supplements PR-time signal until the
L3 equivalents land.

## Update 2026-07-07 — L4a expansion batch merged (PR #5057)

Every remaining cheap-enablement candidate from the 2026-07-02 scan landed on
`main`: the harness now runs **10 specs (14 test cases)** green on the PR check — #1 `instance-health-check`, #3
`smoke-test`, #4 `guest-signin-happy-path`, #5 `settings`, #6 `learning-path-page`,
#7 `home-page-customization`, #8 `sidebar`, #9 `user-settings-info-card`, #10/#11
`application-provider/listener`. Notable mechanics (details in
`docs/e2e-tests/local-e2e-harness.md`):

- `/healthcheck` is proxied to the backend by the app dev server (`proxy` field in
  `packages/app/package.json`), mirroring the production single-origin container.
- The `team-a` ownership entities CI ingests from Keycloak are mirrored as a minimal
  User/Group file ingested via a `catalog.locations` file entry.
- #10/#11's provider/listener test plugins turned out to be **OCI-only builds** that CI
  installs through its Helm values — the harness installs the same packages, so the
  earlier "local-path plugins" caveat is gone.
- The one remaining candidate, #2 `licensed-users-info`, needs **no plugin work at
  all**: the backend plugin is `@internal` and compiled into the RHDH backend
  (`packages/backend/src/index.ts`), so the harness already serves its API. The
  spec-side blocker is that it builds absolute URLs from the root
  `playwright.config.ts` `BASE_URL`, which the harness does not set — a small
  follow-up.

Note: #19 `plugin-dynamic-loading` ships with PR #4967, **open at the time of
writing (2026-07-07)** — the row below describes its state once merged.

## Summary matrix (30 specs: 29 on `main` + #19 pending in PR #4967)

Legend: ✅ = Layer 3 equivalent **already drafted** on branch
[rhdh#4864](https://github.com/redhat-developer/rhdh/pull/4864) (closed, not merged).
🟢 = **validated green on the L4a cluster-free harness** (PRs #5005, #5057).

| #   | Spec                                                                  | Current project     | Cluster? | Renders UI | External svc            | **Target layer**                     |
| --- | --------------------------------------------------------------------- | ------------------- | -------- | ---------- | ----------------------- | ------------------------------------ |
| 1   | `instance-health-check` 🟢                                            | showcase            | no       | no (API)   | none                    | **L2**                               |
| 2   | `plugins/licensed-users-info-backend/licensed-users-info`             | sanity-plugins      | no       | no (API)   | none                    | **L2**                               |
| 3   | `smoke-test` 🟢                                                       | smoke               | no       | yes        | none                    | **L3** (keep a thin L4a smoke)       |
| 4   | `guest-signin-happy-path` 🟢                                          | showcase            | no       | yes        | none                    | **L3**                               |
| 5   | `settings` 🟢                                                         | showcase            | no       | yes        | none                    | **L3** ✅                            |
| 6   | `learning-path-page` 🟢                                               | showcase            | no       | yes        | none                    | **L3** ✅                            |
| 7   | `home-page-customization` 🟢                                          | showcase            | no       | yes        | none                    | **L3**                               |
| 8   | `plugins/frontend/sidebar` 🟢                                         | showcase            | no       | yes        | none                    | **L3** ✅                            |
| 9   | `plugins/user-settings-info-card` 🟢                                  | showcase            | no       | yes        | none                    | **L3** ✅                            |
| 10  | `plugins/application-provider` 🟢                                     | showcase            | no       | yes        | none                    | **L3** (context logic → L1)          |
| 11  | `plugins/application-listener` 🟢                                     | showcase            | no       | yes        | none                    | **L3**                               |
| 12  | `catalog-timestamp`                                                   | showcase            | no       | yes        | GitHub (import)         | **L3** (replace import with fixture) |
| 13  | `audit-log/auditor-rbac`                                              | showcase-rbac       | no       | no (API)   | Keycloak                | **L2** (mock auth)                   |
| 14  | `audit-log/auditor-catalog`                                           | showcase-rbac       | no       | minimal    | GitHub (import)         | **L2 / L4a** (mock GitHub)           |
| 15  | `plugins/http-request`                                                | sanity-plugins      | no       | yes        | GitHub                  | **L4a** (or L2 w/ mock)              |
| 16  | `plugins/scaffolder-backend-module-annotator/annotator`               | sanity-plugins      | no       | yes        | GitHub (repo CRUD)      | **L4a**                              |
| 17  | `plugins/scaffolder-relation-processor/scaffolder-relation-processor` | sanity-plugins      | no       | yes        | GitHub (repo CRUD)      | **L4a**                              |
| 18  | `github-happy-path`                                                   | showcase (`.fixme`) | no       | yes        | GitHub OAuth+API        | **L4a / L4b**                        |
| 19  | `plugin-dynamic-loading`                                              | sanity-plugins      | no       | no (API)   | catalog index image     | **L4a** (already cluster-free)       |
| 20  | `auth-providers/oidc`                                                 | auth-providers      | **yes**  | yes        | Keycloak/RHBK           | **L4b**                              |
| 21  | `auth-providers/microsoft`                                            | auth-providers      | **yes**  | yes        | Azure Entra             | **L4b**                              |
| 22  | `auth-providers/github`                                               | auth-providers      | **yes**  | yes        | GitHub                  | **L4b**                              |
| 23  | `auth-providers/gitlab`                                               | auth-providers      | **yes**  | yes        | GitLab                  | **L4b**                              |
| 24  | `auth-providers/ldap`                                                 | auth-providers      | **yes**  | yes        | Keycloak+LDAP+Azure NSG | **L4b**                              |
| 25  | `external-database/...-crunchy`                                       | runtime-db          | **yes**  | yes        | Crunchy PG              | **L4b**                              |
| 26  | `external-database/...-azure-db`                                      | runtime-db          | **yes**  | yes        | Azure PG (x4)           | **L4b**                              |
| 27  | `external-database/...-rds`                                           | runtime-db          | **yes**  | yes        | AWS RDS (x4)            | **L4b**                              |
| 28  | `configuration-test/config-map`                                       | showcase            | **yes**  | yes        | ConfigMap reload        | **L4b**                              |
| 29  | `verify-redis-cache`                                                  | showcase            | **yes**  | yes        | Redis (port-fwd)        | **L4b**                              |
| 30  | `plugin-division-mode-schema/verify-schema-mode`                      | runtime             | **yes**  | minimal    | K8s + restricted DB     | **L4b**                              |

### Tally

| Target         | Count | Specs                                       |
| -------------- | ----- | ------------------------------------------- |
| **L2**         | 4     | #1, #2, #13, #14                            |
| **L3**         | 10    | #3\*, #4, #5, #6, #7, #8, #9, #10, #11, #12 |
| **L4a**        | 5     | #15, #16, #17, #18, #19                     |
| **L4b (stay)** | 11    | #20–#30                                     |

\* smoke-test: migrate the assertion to L3 but keep a minimal L4a/L4b smoke as a deployment heartbeat.

## Already drafted in [rhdh#4864](https://github.com/redhat-developer/rhdh/pull/4864) (closed, not merged)

Four of the L3 candidates already have a Layer 3 equivalent drafted under epic
RHIDP-13235 (Layer 3 component tests), carried by PR #4864. These prove the pattern
works and should be the template for the rest (the PR is the durable reference — its
branch may be rebased or deleted):

| E2E spec                               | Layer 3 equivalent drafted in #4864 |
| -------------------------------------- | ----------------------------------- |
| `learning-path-page` (#6)              | LearningPaths page test             |
| `settings` (#5)                        | settings GeneralPage composition    |
| `plugins/frontend/sidebar` (#8)        | CustomSidebarItem test              |
| `plugins/user-settings-info-card` (#9) | InfoCard build info card test       |
| _(theming / global header feature)_    | app-bar themed branding config test |
| _(header mount points feature)_        | mount-point data resolution test    |

> Note: the epic briefing listed `custom-theme`, `default-global-header`,
> `header-mount-points`, and `dynamic-home-page-customization` as specs — **these do not
> exist as Playwright E2E specs**. The underlying app-next features are instead covered by
> the app-bar-themed-branding and mount-point Layer 3 tests above.

## Suggested batches (feed RHIDP-13528 / RHIDP-13529)

**Batch 1 — finish the started L3 set + the cheap wins** (RHIDP-13528)

- Close out #5, #6, #8, #9 (land the RHIDP-13235 work).
- Add #7 `home-page-customization`, #4 `guest-signin-happy-path`, #10 `application-provider`, #11 `application-listener`.
- L2: #1 `instance-health-check`, #2 `licensed-users-info` (pure backend API → supertest).

**Batch 2 — needs a mock seam** (RHIDP-13529)

- #12 `catalog-timestamp` — replace GitHub import with a static catalog fixture, assert the table column + sort as L3.
- #13 `auditor-rbac` / #14 `auditor-catalog` — L2 with a mocked auth/catalog source; assert emitted audit events.
- #3 `smoke-test` — L3 render, retain thin deployment heartbeat.

**Not in scope for L1/2/3 (keep, possibly move to L4a)**

- #15–#18 scaffolder/GitHub/http-request and github-happy-path → run on the **cluster-free L4a harness** (RHIDP-15082) since they need real GitHub but no cluster. Only drop to L2 if GitHub is mocked, which loses integration signal.
- #19 already L4a.

## Specs that must stay L4b (do not migrate)

#20–#30. These exercise exactly the things lower layers cannot fake:

- **Auth providers** (#20–#24): real IdP token issuance, resolver behavior against live user/group data, session/autologout semantics, dynamic OAuth-app/redirect-URL and firewall (NSG) provisioning.
- **External databases** (#25–#27): real TLS handshake + driver behavior across managed PG versions.
- **Infra wiring** (#28 ConfigMap reload, #29 Redis cache keys, #30 schema-mode restricted-DB role): the value _is_ the cluster integration.

## Open questions

1. For #13/#14 audit-log, is asserting emitted audit events at L2 (mocked source) enough,
   or do we need the real catalog/RBAC wiring to trust the audit pipeline? → recommend L2
   for the event-shape contract, keep one L4b smoke for the wiring.
2. Do we want L4a scaffolder tests to mock GitHub (deterministic, faster) or keep real
   GitHub (true integration)? Coordinate with RHDHPLAN-525 / overlay-repo strategy (RHIDP-13530).
3. ROI: the 9 L3 + 4 L2 candidates are ~648 LOC of UI-only specs today; migrating buys
   PR-time feedback (seconds vs. a nightly cluster deploy) for the most frequently-broken
   surface (UI/config). The 11 L4b specs are where the real cluster cost lives and are
   **not** the optimization target.

## Companion analysis: `rhdh-plugin-export-overlays`

The overlay repo (where plugins are exported/packaged) already runs a **two-tier** test
system — and tier 1 is _already cluster-free_:

| Tier            | Count         | How it runs                                                                                                                                                                       | Cluster? | Equivalent to                       |
| --------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------- |
| **smoke-tests** | 32 workspaces | `docker run` RHDH + sqlite `:memory:` + guest auth, mounts `dynamic-plugins.test.yaml`, asserts the plugin loads (workflow `run-workspace-smoke-tests.yaml`, ubuntu-latest)       | **NO**   | RHDH `plugin-dynamic-loading` (L4a) |
| **e2e-tests**   | 24 workspaces | `run-e2e.sh` → helm/operator deploy + Keycloak; Playwright via `@red-hat-developer-hub/e2e-test-utils` (`rhdh.deploy()`, `k8sClient.getRouteLocation()`, `loginAsKeycloakUser()`) | **YES**  | RHDH auth/cluster specs (L4b)       |

**Takeaway:** the overlay smoke harness is the _same cluster-free pattern_ we want — a
container boot + load check. The migration opportunity is the 24 cluster-bound
`e2e-tests`. There is already an in-repo signal that the team wants this: a TODO in
`workspaces/tech-radar/e2e-tests` reads _"This is cluster-dependent and we need tests
cluster-agnostic."_

### Cluster-coupling of the 24 overlay e2e-tests (data-driven)

Signals: `k8sClient`/`getRouteLocation` (reads cluster routes for companion services),
a workspace `setup.sh` (provisions extra infra), and `keycloak` vs `guest` auth.

| Tier                                                                                      | Effort to make cluster-free                                                                  | Workspaces                                                                                                                                                            |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — easiest** (guest auth, UI-only, no companion infra)                                 | run against the docker-container harness, guest login                                        | `acr`, `analytics`, `quay`, `roadie-backstage-plugins`, `theme`, `bulk-import`                                                                                        |
| **B — medium** (Keycloak, but no companion workload)                                      | needs containerized Keycloak (docker-compose) or switch to guest where auth isn't under test | `app-defaults`, `extensions`, `scorecard`, `scaffolder-backend-module-kubernetes`, `keycloak`, `global-header`, `homepage`, `rbac`, `quickstart`, `adoption-insights` |
| **C — stays cluster (L4b)** (companion services via routes / `setup.sh` / external infra) | not worth migrating — cluster _is_ the test                                                  | `argocd`, `lightspeed`, `tech-radar`, `orchestrator`, `tekton`, `topology`, `backstage`, `github`                                                                     |

### Is there something better than Docker? (in-process vs container)

The cluster-free goal has **two distinct problems**, and they want different tools:

| Validation goal                                                                | Best cluster-free tool                                                                                                                                                                            | Docker needed?                                                               |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Backend plugin **loads** + **API contract** (`/api/<id>`)                      | `@backstage/backend-test-utils` `startTestBackend` (or `createBackend()` + `dynamicPluginsFeatureLoader`) + published `@red-hat-developer-hub/cli` (`install-dynamic-plugins`) for OCI extraction | **No** — in-process Node                                                     |
| Frontend plugin **loads / registers** (scalprum bundle present, no load error) | same harness: bundle check on `dist-scalprum/` + a `dynamicPluginsServiceRef` probe                                                                                                               | **No**                                                                       |
| Frontend **UI behaviour** (Playwright clicks, headings, navigation)            | a _rendered_ frontend — NFS / app-next dynamic-plugins-enabled Backstage dev server                                                                                                               | **No, but** needs the render harness; `startTestBackend` cannot render React |

**There already was a POC for the in-process path: PR #2231** ("replace Docker-based smoke
tests with native Node.js harness", by Rostislav Lan, closed 2026-05-06). It booted a
minimal backend via `createBackend()` + `dynamicPluginsFeatureLoader`, probed `/api/<id>`,
and validated frontend plugins via `dist-scalprum` bundle checks + a loaded-plugin probe.
It was **694 lines of bespoke OCI parsing/download** and was closed for two reasons worth
respecting:

1. **David Festal**: _"wait for when the NFS becomes the default for frontend plugins, and
   we'd be able to directly start a dynamic-plugins-enabled Backstage (not even RHDH) of the
   target Backstage version."_ → the **frontend-render** half is genuinely better solved by
   NFS/app-next, not by faking it.
2. It **predated the published npm CLI**. Now that `install-dynamic-plugins` is on npm
   (the same package RHDH's `plugin-dynamic-loading.spec.ts` reuses, PR #4967), the 694
   lines of OCI handling collapse to a CLI call — the harness becomes small and maintainable.

**So: don't lead with Docker.** The strictly-better move for load/API validation is the
**native in-process harness** (no container, no image pull, runs on any runner, parallel),
reusing the published CLI. Docker/NFS only enters for the UI-rendering tests.

**Update 2026-07-07: this harness has landed.** #2231's idea was rebuilt on the
published CLI and merged as
[overlays#2714](https://github.com/redhat-developer/rhdh-plugin-export-overlays/pull/2714)
(`smoke-tests-native/` — installs plugins with
`cli-module-install-dynamic-plugins`, boots them with `startTestBackend`; ~20x faster
than the per-workspace Docker smoke for that scope), with per-workspace mode added in
[overlays#2731](https://github.com/redhat-developer/rhdh-plugin-export-overlays/pull/2731).
It runs as a dedicated `native-smoke.yaml` workflow alongside — not yet replacing —
the Docker-based `run-workspace-smoke-tests.yaml`.

### Recommendation for the overlay repo (feeds RHIDP-13530 / RHDHPLAN-525)

Build **two harnesses**, not one Docker fixture:

1. **Native backend harness (no Docker)** — **landed as overlays#2714/#2731** (see
   update above): PR #2231's idea on top of the published `install-dynamic-plugins`
   CLI + `startTestBackend`. Can replace all **32 Docker
   smoke-tests** and covers the **load + API surface** of the **12 pure-backend
   workspaces** (their UI e2e, where one exists — e.g.
   `scaffolder-backend-module-kubernetes` — still needs the render harness):
   `3scale, ai-integrations, apiconnect, github-notifications, keycloak,
mcp-integrations, pingidentity, scaffolder-backend-module-{kubernetes,regex,servicenow,sonarqube},
scaffolder-relation-processor`.
2. **Frontend-render harness (NFS / app-next, no cluster)** — for the **24 e2e-tests**,
   which are ~all UI-driven (Playwright `uiHelper`/`openSidebar`/`verifyHeading`).
   `startTestBackend` cannot render these, so this is the NFS-gated path David Festal
   described — exactly the spike in RHIDP-15075 and the harness in RHIDP-15082. Until NFS
   is default, running Playwright against the existing Docker-container RHDH (guest +
   optional containerized Keycloak) is the pragmatic interim, but it is _not_ the end state.

### All 64 workspaces — role × test type

`F` = ships frontend plugin(s), `B` = backend only. `e2e` = UI Playwright, `smoke` = load.

| Bucket                                   | Cluster-free fit                                                         | Workspaces                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pure backend (12)**                    | **Native in-process harness — full (load + API)**                        | 3scale, ai-integrations, apiconnect, github-notifications, keycloak, mcp-integrations, pingidentity, scaffolder-backend-module-kubernetes, scaffolder-backend-module-regex, scaffolder-backend-module-servicenow, scaffolder-backend-module-sonarqube, scaffolder-relation-processor                                                                                                               |
| **Frontend, load-only today (32 smoke)** | **Native harness — bundle + registration probe** (replaces Docker smoke) | acr, acs, analytics, apiconnect, argocd, azure-devops, backstage, backstage-plugins-for-aws, config-viewer, cost-management, dynatrace-dql, extensions, gitlab, jenkins, kiali, konflux, lightspeed, mcp-chat, mta, npm, orchestrator, pagerduty, roadie-backstage-plugins, scorecard, servicenow, sonarqube, tech-radar, x2a (+ keycloak, pingidentity, 3scale, scaffolder-servicenow as backend) |
| **Frontend UI e2e (24)**                 | **Render harness (NFS/app-next) — `startTestBackend` insufficient**      | acr, adoption-insights, analytics, app-defaults, argocd, backstage, bulk-import, extensions, github, global-header, homepage, keycloak, lightspeed, orchestrator, quay, quickstart, rbac, roadie-backstage-plugins, scaffolder-backend-module-kubernetes, scorecard, tech-radar, tekton, theme, topology                                                                                           |
| **No tests yet (≈18)**                   | candidates for native smoke at minimum                                   | adr, announcements, bookmarks, dynatrace, env-viewer, github-notifications, icon-viewer, jfrog-artifactory, lighthouse, mcp-integrations, multi-source-security-viewer, nexus-repository-manager, scaffolder-backend-module-regex, scaffolder-backend-module-sonarqube, scaffolder-relation-processor, tech-insights, todo, translations                                                           |

> The 24 e2e workspaces being ~all UI-driven is confirmed by grep: every one matches
> `uiHelper`/`openSidebar`/`verifyHeading`/`page.*`; only `app-defaults`, `backstage`,
> `global-header`, `roadie-*` additionally have API-style specs. So the UI/render constraint
> is real and is the gating dependency for that bucket.

## References

- Epic RHIDP-13501, Stories RHIDP-15075 (spike), RHIDP-15076 (this), RHIDP-15082 (L4a harness),
  RHIDP-13528/13529 (L3 batches), RHIDP-13530 (overlay coord), RHIDP-13236 (optional retirement).
- Existing L3 work: [rhdh#4864](https://github.com/redhat-developer/rhdh/pull/4864) (closed, not merged; RHIDP-13235).
- Cluster-free L4a harness: [rhdh#5005](https://github.com/redhat-developer/rhdh/pull/5005) (RHIDP-15075);
  expansion to 10 specs: [rhdh#5057](https://github.com/redhat-developer/rhdh/pull/5057).
- Plugin load validation (L4a): `e2e-tests/playwright/e2e/plugin-dynamic-loading.spec.ts` (RHIDP-13508, PR #4967).
- Overlay-repo native smoke harness (no Docker):
  [overlays#2714](https://github.com/redhat-developer/rhdh-plugin-export-overlays/pull/2714),
  workspace mode [overlays#2731](https://github.com/redhat-developer/rhdh-plugin-export-overlays/pull/2731).
