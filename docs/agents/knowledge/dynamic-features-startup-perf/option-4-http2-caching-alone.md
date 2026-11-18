# Option 4 — HTTP/2 / caching alone (insufficient as primary fix)

**Status:** Proposal / spike handoff — **not recommended as the main solution**  
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

## If you still spike this option — steps

1. **Confirm protocol on both hosts**  
   In DevTools Network: protocol column for `remoteEntry.js` on the default host vs the `…-http2…` host (`h2` / `h3` vs `http/1.1`). If the HTTP/2 host is not actually `h2`, fix ingress before drawing conclusions.

2. **Extend cache middleware**  
   File: `packages/backend/src/middleware/dynamicRemotesStaticCache.ts`  
   Today: long `max-age` only for  
   `/.backstage/dynamic-features/remotes/.../static/`  
   Comment explicitly leaves `remoteEntry.js` / `mf-manifest.json` uncached.  
   Spike: short or content-hash-based caching for `remoteEntry.js` (careful: entry URL is **not** content-hashed — stale entry risk on plugin upgrade). Prefer hashed entry URLs or `ETag` + `no-cache` revalidation (like `preload.js`).

3. **A/B preload hints**  
   Temporarily **disable** the preload link loop in `handler.ts` and measure cold FCP.  
   Hypothesis: fewer hints may improve or match performance by reducing contention (counterintuitive but plausible at N=200).

4. **Measure three scenarios**  
   - Cold, cache disabled  
   - Warm, normal cache  
   - Cold with h2 confirmed vs forced h1 if possible  

5. **Decision gate**  
   If cold load remains multi-second with h2 + sensible caching → **stop**; implement option 3 (then 1 or 2).  
   Only invest further here if cold load already meets product targets.

---

## Key files to highlight

| Path | Why |
|------|-----|
| `packages/backend/src/middleware/dynamicRemotesStaticCache.ts` | Current cache policy; entry intentionally uncached |
| `packages/backend/src/middleware/dynamicRemotesStaticCache.test.ts` | Tests for static path matching |
| `packages/backend/src/defaultServiceFactories.ts` | Registers the middleware |
| `packages/backend/src/modules/dynamicFeaturesPreload/handler.ts` | Preload stampede; ETag model for `preload.js` |
| `packages/app/public/index.html` | Early `preload.js` |
| Cluster / chart / operator ingress annotations | HTTP/2, TLS, timeouts (outside app code; chart/operator repos) |

Upstream loader (unchanged by this option):

- `node_modules/@backstage/frontend-dynamic-feature-loader/dist/loader.esm.js`

---

## Acceptance criteria (for a fair evaluation)

- [ ] Document whether production loadtest path is HTTP/2+.  
- [ ] Before/after numbers for any cache-header change (cold **and** warm).  
- [ ] Before/after for preload-on vs preload-off.  
- [ ] Explicit go/no-go: “caching/HTTP alone meets target” or “proceed to option 3/1/2”.

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

## Handoff note for subagents

Use this doc to run a **short measurement spike** and write a go/no-go. Default expectation: **no-go as primary fix**; apply only safe complementary items (e.g. ETag revalidation for entries, confirm h2, reduce preload hints) alongside option 3+.
