# Option 3 — Fat remotes + concatenate remoteEntries only

**Status:** Proposal / spike handoff (recommended **first spike**)  
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

## Suggested implementation steps

### Phase A — Fat remoteEntry (plugin / export tooling)

1. Inspect current `mf-manifest.json` for a sample loadtest plugin (`catalog-tab-*`) and a real plugin (`@backstage/plugin-org-dynamic`): list `remoteEntry` + expose `assets.js.sync`.
2. Find how remotes are built (`rhdh-cli plugin export`, backstage-cli bundle, rspack MF config). Goal: expose module has **empty sync array** and code is inlined into remoteEntry, **or** sync array length 0 with module living in entry.
3. Validate one plugin: after deploy, Network shows only `remoteEntry.js` for that remote during `loadRemote` (async chunks OK later).
4. Roll out pattern to loadtest plugins (many near-identical `@internal/backstage-plugin-catalog-tab-*-dynamic`) for scale proof.

**Likely touchpoints (may live outside this repo):**

- `rhdh-cli` / plugin export MF config  
- Overlay / dynamic plugin build pipeline  
- `docs/dynamic-plugins/migrating-plugins-to-new-frontend-system.md` (document the fat-entry pattern)

### Phase B — Concatenate remoteEntries (this repo)

1. In `dynamicFeaturesPreload`, after collector fills the store, read each remote’s `remoteEntry.js` from disk.  
2. Emit `features-remote-entries.<hash>.js` (or embed in a sibling of `preload.js`).  
3. Ensure sequential eval preserves each container’s `globalName` (from snapshot `globalName` / MF conventions).  
4. Disable per-remoteEntry `<link rel=preload>` when concat is enabled.  
5. Ensure `loadRemote` does not re-download remoteEntry (hook or MF “already loaded” detection via `getRemoteEntryExports`).  
6. Measure: remoteEntry request count → ~0–1; note remaining sync chunk count.

### Phase C — Decide next

- If sync chunks ≈ 0 thanks to fat remotes → **done enough**; polish caching/CSP.  
- If sync chunks still large → extend to option 1 or 2 for sync assets.

---

## Key files to highlight

### RHDH app / backend

| Path | Why |
|------|-----|
| `packages/app/public/index.html` | Script tags for preload / concat bundle |
| `packages/app/src/App.tsx` | Feature loader timing |
| `packages/backend/src/modules/dynamicFeaturesPreload/handler.ts` | Stop N× remoteEntry preloads; serve concat |
| `packages/backend/src/modules/dynamicFeaturesPreload/collector.ts` | Knows each remote’s entry URL / snapshot |
| `packages/backend/src/modules/dynamicFeaturesPreload/store.ts` | `moduleInfo[name].remoteEntry`, `globalName`, `publicPath`, `modules` |
| `packages/backend/src/modules/dynamicFeaturesResolver.ts` | Mount points |
| `packages/backend/src/middleware/dynamicRemotesStaticCache.ts` | Caching story for entry vs static |
| `docs/dynamic-plugins/migrating-plugins-to-new-frontend-system.md` | Sync vs async; keep NFS entry light |

### Upstream

| Path | Why |
|------|-----|
| `node_modules/@backstage/frontend-dynamic-feature-loader/dist/loader.esm.js` | Eager loadRemote |
| `node_modules/@module-federation/runtime-core/dist/global.js` | `getRemoteEntryExports` |
| `node_modules/@module-federation/sdk/dist/dom.js` | Optional createScript hook for skip-download |

### Manifest / on-disk layout (runtime)

Under each dynamic plugin package dist (served at):

```
/.backstage/dynamic-features/remotes/<packageName>/remoteEntry.js
/.backstage/dynamic-features/remotes/<packageName>/mf-manifest.json
/.backstage/dynamic-features/remotes/<packageName>/static/...
```

Snapshot fields used today: `remoteEntry`, `remoteEntryType`, `globalName`, `publicPath`, `modules[].assets.js.sync`.

---

## Acceptance criteria

### Phase A

- [ ] At least one representative plugin: `loadRemote` does not fetch a separate expose sync chunk (or sync list empty in manifest).
- [ ] Feature still registers (FrontendPlugin/Module).

### Phase B

- [ ] All remoteEntries delivered via **one** hashed (or ETag’d) response.
- [ ] Individual `remoteEntry.js` network requests eliminated (or reduced to residual misses).
- [ ] Mass preload links for remoteEntries removed.
- [ ] Cold-load improvement measured; remaining cost attributed (sync chunks vs parse).

### Phase C

- [ ] Written decision: stop / continue to option 1 or 2 for sync.

---

## Out of scope for this option alone

- Full inlining of shared federation vendor chunks (unless trivially required).
- Lazy feature discovery.
- Extensions catalog performance tweaks.

---

## Risks

- Build tooling may not easily “inline expose into remoteEntry” without MF config changes upstream.  
- Concat order / global collisions if two plugins share `globalName` (should be unique; verify).  
- ESM remote entries cannot be naively string-concat-eval’d like classic `global` type — branch on `remoteEntryType`.  
- Fat remoteEntry that is **not** kept thin (static imports of heavy UI) will make the single file huge — enforce async loaders in exposes.

---

## Handoff note for subagents

Treat this as the **preferred spike**. Prove A then B on the loadtest plugin set. Do not start a full option-1 assembler until Phase C says sync chunks still dominate.
