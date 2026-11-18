# Option 4 — HTTP/2 / caching alone (insufficient as primary fix)

**Status:** Hygiene shipped in-tree; **no-go as primary fix**  
**Related options:** At best a **complement** to [option 1](./option-1-prebuilt-hashed-features-bootstrap.md), [option 2](./option-2-bulk-download-mf-hooks.md), or [option 3](./option-3-fat-remotes-concat-remote-entries.md)

---

## Problem (shared context)

### Symptom

RHDH with ~200 frontend dynamic plugins: **~9–10s** cold load. ~212 `remoteEntry.js` + ~362 static chunk requests; ~530 preload hints; FCP ~8s.

### Root cause

Eager Module Federation bootstrap (`preload.js` stampede + `dynamicFrontendFeaturesLoader` `loadRemote` × N). Browser limits concurrency; hundreds of small requests queue.

Warm SPA navigation after remotes load is already ~100ms — the tax is **bootstrap request fan-out**, not Extensions rendering.

### Loadtest instances (A/B for this option)

| Variant | Base URL |
|---------|----------|
| Default | `https://rhdh-loadtest-next-developer-hub-rhdh-loadtest-next.apps.rosa.uuq7u-txdxe-7b9.4akp.p3.openshiftapps.com` |
| HTTP/2 | `https://rhdh-loadtest-next-http2-developer-hub-rhdh-loadtest-next-http2.apps.rosa.uuq7u-txdxe-7b9.4akp.p3.openshiftapps.com` |

Use `/extensions` on both. Guest login; cold load with cache disabled. In DevTools Network, confirm protocol (`h2` / `h3` vs `http/1.1`) on the HTTP/2 host. **This option’s primary experiment** is default vs HTTP/2 (+ any cache/preload tweaks).

---

## This option (what it means)

Rely on transport and cache improvements **without** combining remotes into fewer artifacts:

1. Ensure **HTTP/2 or HTTP/3** end-to-end (OpenShift route / ingress / CDN).  
2. Improve **Cache-Control** for `remoteEntry.js` / manifests (today only hashed `/static/` chunks get long cache).  
3. Keep or tune `<link rel=preload>` (already aggressive — see risk).  
4. Optionally CDN / edge cache in front of the cluster.

**Claim to validate or refute:** multiplexing + caching makes O(N) remotes “fast enough” that bundling is unnecessary.

---

## Why this is unlikely to be enough

| Factor | Reality at N≈200 |
|--------|------------------|
| HTTP/2 multiplexing | Helps vs HTTP/1.1 connection limits, but each request still has overhead; browsers and servers still apply stream / priority limits |
| Preload of everything | Already implemented; **created** ~530 competing loads — does not solve stampede |
| Caching `remoteEntry.js` | Helps **repeat** visits; cold load / first visit / hard refresh still fetches all N |
| Small file sizes | remoteEntry ~few KB each — problem is **count/latency**, not MB alone |
| Measured FCP | ~8s even when many resources show tiny/`0` transfer (disk cache) in some runs — parse + scheduling still hurt |

Conclusion from prior investigation: treat this option as **hygiene**, not the primary fix.

---

## What shipped (hygiene)

| Item | Status |
|------|--------|
| Revalidation-safe Cache-Control for `remoteEntry.js` / `mf-manifest.json` (`no-cache`; ETag from `express.static` / `send`) | Done |
| Keep long-lived Cache-Control for hashed `/static/` chunks | Unchanged |
| Kill-switch `dynamicPlugins.frontend.preloadRemotes.enabled` (default **true**) | Done |
| When kill-switch is `false`: `preload.js` still prefills `moduleInfo` + remotes fetch shim; skips N× remoteEntry/sync `<link rel=preload\|modulepreload>`; keeps shared-module modulepreloads | Done |
| Unit tests for middleware + preload kill-switch | Done |
| Note in `docs/dynamic-plugins/override-core-services.md` to re-include middleware if replacing `core.rootHttpRouter` | Done |

### Cache policy

File: `packages/backend/src/middleware/dynamicRemotesStaticCache.ts`

| Path pattern | Cache-Control |
|--------------|---------------|
| `/.backstage/dynamic-features/remotes/<plugin>/static/...` | `public, max-age=1209600` (content-hashed) |
| `.../remoteEntry.js`, `.../mf-manifest.json` | `no-cache` (revalidate via ETag; **not** long immutable — entry URLs are unhashed) |

### Preload kill-switch

```yaml
dynamicPlugins:
  frontend:
    preloadRemotes:
      enabled: true   # default when omitted; set false to drop N× link stampede
```

Wired in `dynamicFeaturesResolver` → `mountPreloadEndpoint(..., { preloadRemotesEnabled })`.

---

## Measurement (best-effort, 2026-11-18)

Tooling: `playwright-cli` (Chromium), guest login, navigate to `/extensions`, CDP `Network.setCacheDisabled`, wall clock to networkidle-ish, Performance paint + CDP response protocol.

| Host | Protocol (CDP) | remoteEntry.js | `/static/` chunks | FCP (ms) | Wall to idle-ish (ms) |
|------|----------------|----------------|-------------------|----------|------------------------|
| Default | `http/1.1` | ~214 | ~522 (incl. duplicates across navigations) | **6580** (first run) / **16296** (noisy re-run) | ~7.7s / ~19s |
| HTTP/2 | **`h2`** confirmed | **212** | **362** | **5916** | ~8.4s |

Notes:

- curl/`--http2` also shows default → HTTP/1.1 and `…-http2…` → HTTP/2 (`via: 1.1 Caddy` on the h2 edge).
- Absolute timings vary with cluster load and coldness; treat as order-of-magnitude.
- **Preload on vs off** was **not** measured on these hosts (kill-switch not deployed there yet). Measure after rolling a build with `preloadRemotes.enabled: false` on one replica.
- Cache-header change also **not** yet on these hosts; warm 304 benefit is expected after deploy, cold first visit still O(N).

### Go / no-go

| Criterion | Result |
|-----------|--------|
| Production loadtest HTTP/2 path actually `h2`? | **Yes** on the dedicated HTTP/2 host |
| Cold load already meets product target with h2 alone? | **No** — still multi-second FCP (~6s best observed) with ~212 remotes |
| Caching/HTTP alone as primary fix? | **No-go** — proceed with option 3 / 1 / 2 to cut request count |
| Ship safe complementary hygiene? | **Yes** — entry `no-cache` revalidation + optional preload kill-switch |

---

## Acceptance criteria (for a fair evaluation)

- [x] Document whether production loadtest path is HTTP/2+.  
- [x] Before/after numbers for protocol A/B (cold; cache-disabled). Cache-header before/after deferred until deploy.  
- [ ] Before/after for preload-on vs preload-off (needs deploy of kill-switch).  
- [x] Explicit go/no-go: **caching/HTTP alone does not meet target** → proceed to option 3/1/2; keep hygiene.

**Do not** mark this option done merely because warm loads improved.

---

## Out of scope

- Assembling combined JS bundles (options 1–3).  
- Changing eager `loadRemote` semantics.  
- Extensions catalog API tweaks.

---

## Risks of over-investing here

- False confidence from warm-cache demos.  
- Stronger caching of unhashed `remoteEntry.js` → users stuck on stale containers after plugin upgrade.  
- More preloads make cold load worse.  
- Delays the real fix (reduce request count).

---

## Key files

| Path | Why |
|------|-----|
| `packages/backend/src/middleware/dynamicRemotesStaticCache.ts` | Static long-cache + entry `no-cache` |
| `packages/backend/src/middleware/dynamicRemotesStaticCache.test.ts` | Path matching tests |
| `packages/backend/src/defaultServiceFactories.ts` | Registers the middleware |
| `packages/backend/src/modules/dynamicFeaturesPreload/handler.ts` | Preload body + kill-switch |
| `packages/backend/src/modules/dynamicFeaturesResolver.ts` | Reads `preloadRemotes.enabled` |
| `packages/app/public/index.html` | Early `preload.js` |
| Cluster / chart / operator ingress annotations | HTTP/2, TLS, timeouts (outside app code) |
