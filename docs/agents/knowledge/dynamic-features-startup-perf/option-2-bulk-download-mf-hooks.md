# Option 2 — Bulk download + Module Federation load hooks

**Status:** Implemented (v1 — classic remoteEntries + sync chunks in map)  
**Related options:** Competing design with [option 1](./option-1-prebuilt-hashed-features-bootstrap.md); can start with remoteEntries-only like [option 3](./option-3-fat-remotes-concat-remote-entries.md)  
**Not this option:** [option 4](./option-4-http2-caching-alone.md)

---

## Problem (shared context)

### Symptom

RHDH with ~200 frontend dynamic plugins takes **~9–10s** to first interactive paint on any route (measured on `/extensions`).

| Metric (cold load, cache disabled) | Value |
|------------------------------------|-------|
| Wall time to Extensions `<h1>` | ~8.9s |
| First Contentful Paint | ~8.0s |
| Federation remotes | ~212 |
| `remoteEntry.js` fetches | ~212 |
| Remote `/static/` chunk fetches | ~362 |
| Preload link tags from `preload.js` | ~530 |
| `preload.js` size | ~1.1 MB (metadata only) |
| SPA nav after remotes loaded | ~100ms |

### Root cause

Eager MF bootstrap: `preload.js` injects hundreds of preload hints, then `dynamicFrontendFeaturesLoader` `loadRemote`s every NFS expose. Browser connection limits serialize ~500+ small requests.

Extensions UI is not the bottleneck.

### Why remotes are needed at start

Current NFS loader must evaluate every exposed `FrontendPlugin` / `FrontendModule` at bootstrap. Startup set = remoteEntry + expose sync chunks (async UI chunks can remain lazy).

### Loadtest instances

| Variant | Base URL |
|---------|----------|
| Default | `https://rhdh-loadtest-next-developer-hub-rhdh-loadtest-next.apps.rosa.uuq7u-txdxe-7b9.4akp.p3.openshiftapps.com` |
| HTTP/2 | `https://rhdh-loadtest-next-http2-developer-hub-rhdh-loadtest-next-http2.apps.rosa.uuq7u-txdxe-7b9.4akp.p3.openshiftapps.com` |

Use `/extensions` on either host. Guest login; cold load with cache disabled. This option should improve both; HTTP/2 is useful as a baseline, not a substitute.

---

## This option (goal)

Same **user outcome** as option 1 (one network transfer for startup remotes), but implemented by:

1. **Backend:** one bulk endpoint that returns all needed JS payloads (URL-keyed JSON).  
2. **Client:** evaluate/register containers from that payload.  
3. **MF hooks:** intercept subsequent script/fetch loads so `loadRemote` / chunk loading **no-ops** when the asset was already provided.

This avoids rewriting each remote’s webpack chunk graph inside a mega-assembler (option 1’s hardest part), by teaching the MF runtime “this URL is already satisfied.”

---

## What was implemented (v1)

| Item | Status |
|------|--------|
| Assemble URL-keyed `bulk.json` (classic `remoteEntry` + expose sync JS) from `PreloadStore` + on-disk `dist/` | Done (`bulk.ts`) |
| Serve `bulk.json` with content-hash ETag / `no-cache` | Done (`handler.ts`) |
| Disable mass classic remoteEntry/sync JS `<link rel=preload>` when bulk active | Done |
| Keep ESM `modulepreload` + shared `.mjs` modulepreload + sync CSS preload | Done |
| Client: fetch bulk, `eval` classic remoteEntries (faked `currentScript` for webpack publicPath) before `loadRemote` | Done (`packages/app/src/dynamicFeaturesBulk/`) |
| MF runtime plugin via `dynamicFrontendFeaturesLoader({ moduleFederation: { plugins } })` — `createScript` (eval + data: no-op) + `fetch` short-circuit | Done |
| Config flag `dynamicPlugins.frontend.bulkRemoteEntries.enabled` (default **true**) | Done |
| Unit + integration tests (backend bulk + app source map / hooks) | Done |
| ESM (`module`/`esm`) remoteEntry in bulk eval map | **Deferred** (skipped; modulepreload kept) |
| Before/after Playwright cold-load numbers on loadtest | **Deferred** (measure after deploy) |

### How to enable / disable

```yaml
dynamicPlugins:
  frontend:
    bulkRemoteEntries:
      enabled: true   # default when omitted
```

Set `enabled: false` to restore the legacy mass `<link rel=preload>` stampede and serve an empty `bulk.json` stub (`sources: {}`, `evaluate: []`).

### Payload shape

`GET /.backstage/dynamic-features-preload/bulk.json`:

```json
{
  "version": 1,
  "sources": { "<absolutePublicUrl>": "<js source text>", ... },
  "evaluate": ["<classic remoteEntry urls only>"]
}
```

- **`evaluate`:** classic remoteEntries only — client runs these so `window[globalName]` exists; MF `getRemoteEntryExports` then skips `loadScript`.
- **`sources`:** also includes expose sync JS chunks when readable on disk for MF `createScript`/`fetch` hooks. They are **not** eagerly evaluated. **Caveat:** many remotes load sync chunks via webpack’s own `__webpack_require__.e` script injection, which may **bypass** MF loader hooks — measure after deploy; if sync fan-out remains, follow up (fat remotes / option 3, or a deeper chunk-load shim).

`preload.js` embeds `window.__DYNAMIC_FEATURES_BULK__ = { enabled, hash, url }` for the app wrapper.

### How MF avoids re-downloading

1. **Primary:** after bulk eval (with faked `currentScript`), `loadEntryScript` → `getRemoteEntryExports` hits and returns (no network).
2. **Safety / sync chunks:** `rhdh-bulk-remote-entries` plugin hooks `createScript` (eval from map + data: no-op onload) and `fetch` (in-memory `Response`).

### CSP

| Path | Requirement |
|------|-------------|
| Classic remoteEntry apply | Indirect `eval` with faked `document.currentScript` → needs `script-src 'unsafe-eval'` (Backstage default) |
| `createScript` hook | Evals mapped source (same currentScript fake), returns `data:text/javascript,` no-op for onload — **not** blob source (blob breaks webpack `publicPath: "auto"`) |
| `bulk.json` / `preload.js` | Same-origin external fetches; no inline script bodies in HTML |

**Why fake `currentScript`:** real webpack remotes resolve `publicPath: "auto"` from `document.currentScript.src`. Plain `(0, eval)` leaves it null (wrong fallback / throw). Blob `script.src` also yields a bad publicPath after webpack strips `blob:`.

---

## Design sketch (as built)

```
index.html
  └─ preload.js (moduleInfo + remotes shim + bulk meta; NO N× classic preload links)

app bootstrap (rhdhDynamicFrontendFeaturesLoader)
  └─ await GET /.backstage/dynamic-features-preload/bulk.json
       └─ eval classic remoteEntries; index sources Map
  └─ dynamicFrontendFeaturesLoader({ moduleFederation: { plugins: [bulkPlugin] } })
       └─ loadRemote → getRemoteEntryExports hit / createScript|fetch from Map
```

---

## Key files

### RHDH

| Path | Why |
|------|-----|
| `packages/app/public/index.html` | Early `preload.js` (unchanged defer tag) |
| `packages/app/src/App.tsx` | Uses `rhdhDynamicFrontendFeaturesLoader()` |
| `packages/app/src/dynamicFeaturesBulk/` | Apply bulk + MF plugin + thin loader wrapper |
| `packages/backend/src/modules/dynamicFeaturesPreload/bulk.ts` | Assembles URL→source map |
| `packages/backend/src/modules/dynamicFeaturesPreload/handler.ts` | Serves preload.js + bulk.json; slim preloads |
| `packages/backend/src/modules/dynamicFeaturesPreload/collector.ts` | `remoteAssetsPaths` inventory |
| `packages/backend/src/modules/dynamicFeaturesResolver.ts` | Config + mount |

### Upstream hooks / APIs

| Path | Why |
|------|-----|
| `node_modules/@backstage/frontend-dynamic-feature-loader/dist/loader.esm.js` | `options.moduleFederation.plugins` |
| `node_modules/@module-federation/runtime-core/dist/utils/load.js` | `getRemoteEntryExports` before `loadScript` |
| `node_modules/@module-federation/sdk/dist/dom.js` | `createScript` / hook return shapes |

### Tests

- `packages/backend/src/modules/dynamicFeaturesPreload/bulk.test.ts`
- `packages/backend/src/modules/dynamicFeaturesPreload/handler.test.ts`
- `packages/backend/src/modules/dynamicFeaturesPreload/integration.test.ts`
- `packages/app/src/dynamicFeaturesBulk/sourceMap.test.ts`

---

## Acceptance criteria

- [x] One bulk request replaces O(N) classic remoteEntry requests at cold start (sync chunks via hooks when in map).
- [x] MF `loadRemote` still used by upstream loader (no fork of feature discovery).
- [x] Hooks prevent duplicate network fetches for URLs already in the bulk map.
- [x] Mass classic preload link injection disabled in bulk mode.
- [x] CSP documented (eval vs blob).
- [ ] Before/after Playwright cold-load numbers.
- [ ] ESM remoteEntries in bulk path (deferred).

---

## Out of scope

- Fully rewriting webpack chunk graphs into one file without hooks (that’s option 1).
- Changing Backstage to lazy-discover features.
- Extensions page-only optimizations.

---

## Risks

- Hook coverage gaps: webpack `__webpack_require__.e` may inject scripts without MF `createScript`/`fetch` (sync fan-out may remain — measure after deploy).
- ESM (`module`/`esm`) remoteEntryType needs `import()` / modulepreload semantics, not classic `eval` — still deferred.
- CSP removing Backstage’s default `script-src 'unsafe-eval'` would break apply / createScript eval.
- If `bulk.json` fetch fails at runtime while preload already skipped mass classic hints, remotes fall back to cold network (no preload warming).
- Race: mitigated by awaiting bulk apply inside the feature-loader wrapper before upstream `loader` runs.
