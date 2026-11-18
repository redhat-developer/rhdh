# Option 2 — Bulk download + Module Federation load hooks

**Status:** Proposal / spike handoff  
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

1. **Backend:** one bulk endpoint that returns all needed JS payloads (concat, multipart, or archive).  
2. **Client:** evaluate/register containers from that payload.  
3. **MF hooks:** intercept subsequent script/fetch loads so `loadRemote` / chunk loading **no-ops** when the asset was already provided.

This avoids rewriting each remote’s webpack chunk graph inside a mega-assembler (option 1’s hardest part), by teaching the MF runtime “this URL is already satisfied.”

---

## Design sketch

```
index.html
  └─ preload.js (slim: moduleInfo + remotes shim; NO N× preload links)
  └─ OR early fetch of bulk endpoint

app bootstrap (before or inside feature loader)
  └─ GET /.backstage/dynamic-features-preload/bulk.js  (or /bulk.json + eval)
       └─ body contains all remoteEntry (+ optionally sync chunk) sources
  └─ register MF plugin/hooks:
       createScript → if url already applied, return dummy / skip attach
       fetch hook → serve from in-memory map
  └─ dynamicFrontendFeaturesLoader → loadRemote (hits memory, not network)
```

### Bulk payload formats (pick one in spike)

| Format | Pros | Cons |
|--------|------|------|
| Single JS that evals each remoteEntry in order | Simple for classic/`global` entries | Sync chunks still need handling |
| JSON map `{ url: sourceText }` + client eval | Easy hook lookup by URL | Large JSON; CSP/eval care |
| Multipart or tar+index | Streaming-friendly | More client code |

Prefer **URL-keyed** content so hooks can match exact `publicPath + remoteEntry` / chunk paths from snapshots.

---

## Suggested implementation steps

1. **Map URLs from `PreloadStore.moduleInfo`**  
   Same inventory as option 1: remoteEntry + expose `modules[].assets.js.sync` (+ decide on shared sync).

2. **Add bulk endpoint**  
   In `dynamicFeaturesPreload` (next to `mountPreloadEndpoint`):
   - Read file bytes from disk (dynamic plugins root) or from whatever the remotes static middleware serves.
   - Assemble response; ETag / content-hash like `preload.js`.
   - Do **not** inject 530 preload links when bulk mode is on.

3. **Client bootstrap hook module (RHDH app)**  
   New small module loaded before `dynamicFrontendFeaturesLoader` runs, e.g. from `packages/app`:
   - `fetch` bulk endpoint once.
   - Populate `Map<absoluteUrl, string | Blob>`.
   - For classic remotes: `eval`/script-append each remoteEntry so `window[globalName]` exists (match MF’s expected global).
   - Register `@module-federation` runtime plugin or pass `plugins` / loader hooks into `createInstance` if the loader allows customization via `dynamicFrontendFeaturesLoader({ moduleFederation: { plugins } })` — **check** current Backstage loader options in `loader.esm.js`.

4. **Hook behavior**  
   - `createScript(url)`: if URL in map and already executed → signal success without network; if not executed → create blob: URL or inline script from map.  
   - Optionally override `fetch` for chunk URLs similarly.  
   - Ensure idempotency (loader may call loadRemote many times).

5. **Order vs preload.js**  
   Bulk must complete **before** `Promise.all(loadRemote)`. Options:
   - Extend `preload.js` to also fetch+apply bulk (keeps one early script), or  
   - Gate feature loader behind an explicit init promise exported by RHDH.

6. **Verify + measure**  
   Network panel: no (or almost no) individual `remoteEntry.js` / expose sync requests during bootstrap. Features still register. Cold-load FCP improves.

---

## Key files to highlight

### RHDH

| Path | Why |
|------|-----|
| `packages/app/public/index.html` | Early script order |
| `packages/app/src/App.tsx` | Where to pass `moduleFederation.plugins` / init order vs loader |
| `packages/backend/src/modules/dynamicFeaturesPreload/handler.ts` | Today’s preload stampede; slim down + add bulk route |
| `packages/backend/src/modules/dynamicFeaturesPreload/collector.ts` | URL inventory source |
| `packages/backend/src/modules/dynamicFeaturesPreload/store.ts` | Store shape |
| `packages/backend/src/modules/dynamicFeaturesResolver.ts` | Mount new endpoint |
| `packages/backend/src/modules/nfsModuleFilter.ts` | What exposes are in scope |

### Upstream hooks / APIs

| Path | Why |
|------|-----|
| `node_modules/@backstage/frontend-dynamic-feature-loader/dist/loader.esm.js` | `options.moduleFederation.plugins`, `createInstance`, eager `loadRemote` |
| `node_modules/@module-federation/sdk/dist/dom.js` | `createScript` / `createScriptHook` |
| `node_modules/@module-federation/runtime-core/dist/core.d.ts` | Hook names: `createScript`, `loadEntry`, `fetch`, etc. |
| `node_modules/@module-federation/runtime-core/dist/global.js` | `getRemoteEntryExports` — success condition after remoteEntry runs |

### Tests

- Extend `handler.test.ts` / `integration.test.ts` for bulk endpoint.
- Add app-side unit test for URL map + hook short-circuit if practical.

---

## Acceptance criteria

- [ ] One (or few) bulk request(s) replace O(N) remoteEntry (+ ideally expose sync) requests at cold start.
- [ ] MF `loadRemote` still used by upstream loader (no fork of feature discovery required).
- [ ] Hooks prevent duplicate network fetches for URLs already in the bulk map.
- [ ] Mass preload link injection disabled in bulk mode.
- [ ] CSP documented (blob URLs vs classic script src vs eval).
- [ ] Before/after Playwright cold-load numbers.

---

## Out of scope

- Fully rewriting webpack chunk graphs into one file without hooks (that’s option 1).
- Changing Backstage to lazy-discover features.
- Extensions page-only optimizations.

---

## Risks

- Hook coverage gaps: MF may load some assets via paths hooks miss (CSS, workers, different attr shapes).
- ESM (`module`/`esm`) remoteEntryType needs `import()` / modulepreload semantics, not classic `eval`.
- Race: `loadRemote` starting before bulk apply finishes.
- Passing custom MF plugins through Backstage loader — confirm API stability.

---

## Suggested spike order (minimal)

1. Bulk **remoteEntries only** + `createScript` short-circuit after eval.  
2. Measure remaining sync-chunk fan-out.  
3. If still large, add sync chunks to bulk map + fetch/createScript hooks.  
4. Only then consider merging with option 1’s single hashed file if hooks prove messy.
