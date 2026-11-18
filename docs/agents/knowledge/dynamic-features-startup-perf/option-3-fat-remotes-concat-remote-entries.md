# Option 3 — Fat remotes + concatenate remoteEntries only

**Status:** Spike implemented in-repo (Phase A docs + Phase B concat)  
**Related options:** Subset / stepping stone toward [option 1](./option-1-prebuilt-hashed-features-bootstrap.md) or [option 2](./option-2-bulk-download-mf-hooks.md)  
**Not this option:** [option 4](./option-4-http2-caching-alone.md)

---

## Problem (shared context)

### Symptom

RHDH with ~200 frontend dynamic plugins: **~9–10s** cold load to interactive app shell. Dominated by **request count**, not Extensions UI.

| Metric | Approx. |
|--------|---------|
| Remotes | ~212 |
| `remoteEntry.js` requests | ~212 |
| Sync/static chunk requests | ~362 |
| Preload `<link>` tags | ~530 |
| FCP | ~8s |
| Warm SPA navigation | ~100ms |

### Root cause

Eager `loadRemote` × N + `preload.js` hint stampede. Each remote typically costs **at least** `remoteEntry.js` + one expose sync chunk (often more).

### Loadtest instances

| Variant | Base URL |
|---------|----------|
| Default | `https://rhdh-loadtest-next-developer-hub-rhdh-loadtest-next.apps.rosa.uuq7u-txdxe-7b9.4akp.p3.openshiftapps.com` |
| HTTP/2 | `https://rhdh-loadtest-next-http2-developer-hub-rhdh-loadtest-next-http2.apps.rosa.uuq7u-txdxe-7b9.4akp.p3.openshiftapps.com` |

Use `/extensions` on either host. Guest login; cold load with cache disabled. Measure on both if possible — concat should help regardless of protocol.

---

## This option (goal)

Two complementary moves, both smaller than a full mega-assembler:

### A. Fat remotes (per-plugin build)

Configure / build each frontend dynamic plugin so the **NFS expose sync graph lives inside `remoteEntry.js`** (no separate `__federation_expose_*.chunk.js` on the startup path).

Result per plugin: **1 JS file** to evaluate for feature registration instead of 2+.

Documented intent already exists: keep NFS entry lightweight *and* understand sync vs async — see `docs/dynamic-plugins/migrating-plugins-to-new-frontend-system.md`. Here we additionally want **fewer files**, not only fewer bytes: ideally remoteEntry embeds the small expose sync graph.

### B. Concatenate all remoteEntries into one transfer

Backend (or preload pipeline) builds one content-hashed file:

```
features-remote-entries.<hash>.js
```

containing every remote’s `remoteEntry.js` body, evaluated in sequence so each `globalName` registers on `window`.

Then either:

- load that one script from `index.html` / slim `preload.js`, and  
- short-circuit MF script loads for those remoteEntry URLs (lightweight hook), **or**  
- rely on globals already present when `getRemoteEntry` runs.

**End state:** ~1 request for all containers (plus shared host/runtime as today), **if** fat remotes succeeded. If exposes still split out, concat alone only halves the problem (212 → 1 for entries, sync chunks remain).

---

## Why start here

| Advantage | Detail |
|-----------|--------|
| Lower risk | Classic remoteEntries are often self-contained IIFEs that only register a container global |
| Incremental | Prove concat+globals before tackling sync-chunk rewriting (option 1) or full hook matrix (option 2) |
| Aligns with plugin guidance | Thin expose + async UI; fat remoteEntry can still be small if blueprints use `import()` |
| Clear metrics | Count `remoteEntry` vs `/static/` requests before/after each sub-step |

---

## Implementation status

### Phase A — Fat remoteEntry (plugin / export tooling) — **docs done; tooling deferred**

| Item | Status |
|------|--------|
| Document fat-remoteEntry pattern + `mf-manifest` validation in `docs/dynamic-plugins/migrating-plugins-to-new-frontend-system.md` | **Done** (this repo) |
| Change `rhdh-cli` / overlay MF config so expose `assets.js.sync` is empty | **Deferred** — CLI lives outside this repo |
| Validate one plugin on loadtest (Network: only `remoteEntry.js` before register) | **Deferred** — needs export tooling + deploy |
| Roll out to loadtest `catalog-tab-*` plugins | **Deferred** |

### Phase B — Concatenate remoteEntries (this repo) — **done**

| Item | Status |
|------|--------|
| Read classic `remoteEntry.js` from disk after collector fills the store (`remoteAssetsPaths`) | **Done** |
| Emit `features-remote-entries.<hash>.js` (+ stable `features-remote-entries.js` ETag alias) | **Done** |
| ASI-safe concat; path containment; fake `document.currentScript` for `publicPath: "auto"` | **Done** |
| Load from `packages/app/public/index.html` (defer after `preload.js`) | **Done** |
| Disable mass classic remoteEntry `<link rel=preload>` when concat active (`dynamicPlugins.frontend.concatRemoteEntries.enabled`, default `true`) | **Done** — sync JS/CSS preloads **kept** |
| Rely on `getRemoteEntryExports` / `window[globalName]` (no MF createScript hook) | **Done** |
| Unit + integration tests under `packages/backend/src/modules/dynamicFeaturesPreload/` | **Done** |
| ESM remotes in concat | **Out of scope** — still modulepreloaded individually |
| Sync-chunk inlining | **Out of scope** (option 1 stretch) |
| bulk.json MF hooks | **Out of scope** (option 2) |

**Config:** `dynamicPlugins.frontend.concatRemoteEntries.enabled` (boolean, default `true`).

**Key code:**

- `packages/backend/src/modules/dynamicFeaturesPreload/concatRemoteEntries.ts`
- `packages/backend/src/modules/dynamicFeaturesPreload/handler.ts`
- `packages/backend/src/modules/dynamicFeaturesResolver.ts`
- `packages/app/public/index.html`

### Phase C — Decide next — **decision note**

**Stop / continue criteria after measuring a cold load with concat on:**

| Observation | Decision |
|-------------|----------|
| Sync/static chunk requests ≈ 0 (fat remotes landed) and remoteEntry requests ≈ 0–1 | **Stop** — polish caching/CSP; option 3 is enough |
| remoteEntry ≈ 0–1 but sync chunks still dominate (hundreds of `/static/` fetches) | **Continue** to [option 1](./option-1-prebuilt-hashed-features-bootstrap.md) (sync inlining) or [option 2](./option-2-bulk-download-mf-hooks.md) (bulk + hooks) |
| Concat causes publicPath / registration regressions | Fix currentScript wrapping / containment; do not jump to option 1 until concat is stable |

**Do not** merge option 1 or 2 while this spike is the preferred first measurement. This branch proves remoteEntries-only concat without sync inlining or bulk hooks.

---

## Acceptance criteria

### Phase A

- [x] Fat-remote pattern documented (validate via `mf-manifest` `assets.js.sync`).
- [ ] At least one representative plugin: `loadRemote` does not fetch a separate expose sync chunk (needs export tooling outside this repo).
- [ ] Feature still registers (FrontendPlugin/Module) — validate on loadtest after tooling.

### Phase B

- [x] All classic remoteEntries delivered via **one** hashed (or ETag’d) response.
- [x] Mass preload links for classic remoteEntries removed when concat is active.
- [ ] Individual `remoteEntry.js` network requests eliminated on loadtest (measure).
- [ ] Cold-load improvement measured; remaining cost attributed (sync chunks vs parse).

### Phase C

- [x] Written decision criteria: stop / continue to option 1 or 2 for sync (see above).

---

## Out of scope for this option alone

- Full inlining of shared federation vendor chunks (unless trivially required).
- Lazy feature discovery.
- Extensions catalog performance tweaks.
- Sync-chunk inlining (option 1) and bulk.json MF hooks (option 2).

---

## Risks

- Build tooling may not easily “inline expose into remoteEntry” without MF config changes upstream.  
- Concat order / global collisions if two plugins share `globalName` (should be unique; verify).  
- ESM remote entries cannot be naively string-concat-eval’d like classic `global` type — branch on `remoteEntryType` (skipped).  
- Fat remoteEntry that is **not** kept thin (static imports of heavy UI) will make the single file huge — enforce async loaders in exposes.
- `publicPath: "auto"` requires faking `document.currentScript` per wrapped body (implemented).

---

## Handoff note

Treat this as the **preferred spike**. Prove A (tooling elsewhere) then B (this repo — done) on the loadtest plugin set. Do not start a full option-1 assembler until Phase C measurement says sync chunks still dominate.
