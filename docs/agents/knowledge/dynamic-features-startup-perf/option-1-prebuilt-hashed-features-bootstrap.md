# Option 1 — Prebuilt hashed features bootstrap JS

**Status:** Implemented (v1 — classic remoteEntries only)  
**Related options:** Competing with [option 2](./option-2-bulk-download-mf-hooks.md); [option 3](./option-3-fat-remotes-concat-remote-entries.md) is a simpler subset  
**Not this option:** [option 4](./option-4-http2-caching-alone.md) (HTTP/2/caching alone)

---

## Problem (shared context)

### Symptom

RHDH with ~200 frontend dynamic plugins takes **~9–10s** to first interactive paint on any route (measured on `/extensions`).

| Metric (cold load, cache disabled) | Value |
|------------------------------------|-------|
| Wall time to Extensions `<h1>` | ~8.9s |
| First Contentful Paint | ~8.0s |
| Federation remotes (`moduleInfo`) | ~212 |
| `remoteEntry.js` fetches | ~212 |
| Remote `/static/` chunk fetches | ~362 |
| `<link rel=preload\|modulepreload>` injected by `preload.js` | ~530 |
| `preload.js` size | ~1.1 MB (metadata only) |
| SPA nav after remotes already loaded | ~100ms |

### Root cause

App bootstrap **eagerly** loads every NFS Module Federation remote before features resolve:

1. `packages/app/public/index.html` loads `/.backstage/dynamic-features-preload/preload.js`.
2. That script prefills `window.__FEDERATION__.moduleInfo`, shims `GET …/remotes`, and (legacy) injects **hundreds** of preload hints for every `remoteEntry` + expose sync assets.
3. `@backstage/frontend-dynamic-feature-loader` (`dynamicFrontendFeaturesLoader` in `packages/app/src/App.tsx`) does `Promise.all(… instance.loadRemote(…))` for **every** exposed module.
4. Browser connection limits turn ~500+ small JS requests into a multi-second queue.

The Extensions catalog UI is **not** the bottleneck (warm SPA nav ~100ms; catalog APIs are secondary).

### Why remotes are needed at start (current architecture)

Backstage NFS discovers `FrontendPlugin` / `FrontendModule` by evaluating each remote expose. Until that completes, the app cannot resolve the extension tree (sidebar, pages, etc.). Async UI chunks behind `loader: () => import(…)` can stay lazy; **remoteEntry + expose sync chunks** are the startup set.

### Loadtest instances (for reproduction)

| Variant | Base URL |
|---------|----------|
| Default | `https://rhdh-loadtest-next-developer-hub-rhdh-loadtest-next.apps.rosa.uuq7u-txdxe-7b9.4akp.p3.openshiftapps.com` |
| HTTP/2 | `https://rhdh-loadtest-next-http2-developer-hub-rhdh-loadtest-next-http2.apps.rosa.uuq7u-txdxe-7b9.4akp.p3.openshiftapps.com` |

Use `/extensions` on either host. Guest login → measure with Playwright, cache disabled. Expect ~212 remotes, ~530 preload links, FCP ~8s on default (before this change). Prefer the HTTP/2 host when comparing transport effects; this option’s win should show on **both**.

---

## This option (goal)

Assemble, at **backend startup**, a **single content-hashed JS file** that contains every classic remote’s `remoteEntry.js` body (so each container registers under its `globalName`).

Serve it as:

```
/.backstage/dynamic-features-preload/features.<contenthash>.js
```

Stable alias for `index.html`:

```
/.backstage/dynamic-features-preload/features.js
```

Keep a slim `preload.js` for remotes list + `moduleInfo` + fetch shim, and **stop** injecting N classic remoteEntry/sync JS preload link tags when the bootstrap is active.

**v1 end state:** O(1) remoteEntry network requests (the bootstrap file) instead of O(N). Sync expose chunks still fan out (follow-up).

---

## What was implemented (v1)

| Item | Status |
|------|--------|
| Assemble classic `remoteEntry.js` bodies at backend startup from `PreloadStore` + on-disk `dist/` | Done (`bootstrap.ts`) |
| Serve `features.<hash>.js` (immutable) + stable `features.js` (ETag / no-cache) | Done (`handler.ts`) |
| `index.html` loads `preload.js` then `features.js` (both `defer`) | Done |
| Disable mass classic remoteEntry/sync **JS** `<link rel=preload>` when bootstrap active | Done |
| Keep ESM `modulepreload` + shared `.mjs` modulepreload + sync CSS preload | Done |
| MF skips re-download via existing `getRemoteEntryExports` / `window[globalName]` | Done (documented; no `createScript` hook) |
| Config flag `dynamicPlugins.frontend.featuresBootstrap.enabled` (default **true**) | Done |
| Unit + integration tests | Done |
| Inline expose **sync** chunks into the mega-file | **Deferred** |
| ESM (`module`/`esm`) remoteEntry inlining | **Deferred** (skipped with reason; modulepreload kept) |
| Before/after Playwright cold-load numbers on loadtest | **Deferred** (measure after deploy) |

### How to enable / disable

```yaml
dynamicPlugins:
  frontend:
    featuresBootstrap:
      enabled: true   # default when omitted
```

Set `enabled: false` to restore the legacy mass `<link rel=preload>` stampede and serve an empty `features.js` stub.

### How hashing / cache works

1. At first request after startup, the assembler reads each classic remote’s `remoteEntry` from `<pluginPackagePath>/dist`, concatenates with comments, and SHA-256–hashes the bytes (16 hex chars).
2. **`features.<hash>.js`**: `Cache-Control: public, max-age=31536000, immutable`. Wrong hash → 404.
3. **`features.js`**: same body, `Cache-Control: no-cache` + `ETag: "<hash>"` (304 on revalidation). This is what `index.html` references so the HTML does not need the hash at build time.
4. **`preload.js`**: still `no-cache` + 8-char content ETag; embeds `window.__DYNAMIC_FEATURES_BOOTSTRAP__ = { enabled, hash, url, stableUrl }` for debugging.
5. Plugin add/remove/upgrade → process restart → new assembly → new hash → browsers fetch new bytes.

### How MF avoids re-downloading remoteEntries

Classic remoteEntry scripts register the container on `window[globalName]` (or `__FEDERATION_${name}:custom__`).  
`@module-federation/runtime-core` `loadEntryScript` calls `getRemoteEntryExports(name, globalName)` **before** `loadScript`; if exports already exist, it returns immediately. No RHDH `createScript` hook is required for classic remotes.

### CSP

Bootstrap remains an **external** script URL (same origin as preload.js). No `eval` / inline script bodies. Existing CSP that allows `script-src` for the app origin continues to work.

---

## Why sync-chunk inlining is hard (deferred)

Each remote is its own webpack/rspack MF **container**:

- Own runtime / chunk map / `publicPath`
- Sync chunks loaded via that runtime (`script.src = publicPath + chunk`)
- Naive `cat remoteEntry.js sync/*.js` → chunk-id collisions, double-fetch, broken `get()`

Follow-ups to explore:

- Rewrite / suppress per-remote chunk loading for inlined sync assets, or  
- Emit remotes such that expose sync is already inside `remoteEntry` (see option 3), then only assemble remoteEntries.

Shared federation modules remain a separate concern (host share scope).

---

## Key files

### RHDH (this repo)

| Path | Why |
|------|-----|
| `packages/app/public/index.html` | Loads `preload.js` then `features.js` |
| `packages/backend/src/modules/dynamicFeaturesResolver.ts` | Registers preload + bootstrap + NFS filter + shared assets |
| `packages/backend/src/modules/dynamicFeaturesPreload/bootstrap.ts` | Assembles classic remoteEntry mega-file |
| `packages/backend/src/modules/dynamicFeaturesPreload/handler.ts` | Serves `preload.js` / `features.js` / `features.<hash>.js` |
| `packages/backend/src/modules/dynamicFeaturesPreload/collector.ts` | Fills remotes + moduleInfo + `remoteAssetsPaths` |
| `packages/backend/src/modules/dynamicFeaturesPreload/store.ts` | In-memory preload store shape |
| `packages/backend/src/modules/dynamicFeaturesPreload/paths.ts` | URL constants |
| `packages/backend/src/modules/nfsModuleFilter.ts` | Only NFS exposes are collected/loaded |
| `packages/backend/src/middleware/dynamicRemotesStaticCache.ts` | Long-cache for `/static/` only; `remoteEntry.js` intentionally uncached today |

### Tests

- `packages/backend/src/modules/dynamicFeaturesPreload/bootstrap.test.ts`
- `packages/backend/src/modules/dynamicFeaturesPreload/handler.test.ts`
- `packages/backend/src/modules/dynamicFeaturesPreload/integration.test.ts`

---

## Acceptance criteria

- [x] Feature bootstrap uses **O(1)** hashed/stable JS requests for classic **remoteEntries** (not O(N) per remote).
- [x] Mass classic remoteEntry/sync JS `<link rel=preload>` removed when bundle is active.
- [ ] All NFS features that load today still load (spot-check sidebar + one page plugin on a real cluster).
- [x] Bundle URL content-hash changes when any included remote changes; browsers get new bytes.
- [x] Document CSP / caching behavior.
- [ ] Before/after timing numbers recorded (Playwright cold load).
- [ ] Sync expose chunks also O(1) (deferred).

---

## Out of scope for this option

- Lazy `loadRemote` (changing Backstage feature discovery) — complementary, not required here.
- Extensions catalog pagination / React Query dedupe — separate, secondary.
- Relying only on HTTP/2 multiplexing (option 4).

---

## Risks

- Assembler complexity and webpack runtime edge cases across classic vs ESM remote entry types (`remoteEntryType`: `global` vs `module`/`esm`) — v1 skips ESM inlining.
- Mega-file parse/eval CPU on mid-tier clients (still better than N remoteEntry RTTs).
- Dynamic plugin install at runtime requires process restart (or future rebuild) of the hashed file before next page load.
- Sync-chunk network fan-out remains until follow-up.
- Divergence from upstream MF assumptions — changes kept in RHDH backend + app HTML.
