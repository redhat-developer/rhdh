# Serve dynamic frontend plugin remote entries under content-hashed URLs

Dynamic frontend plugin remote entries (`remoteEntry.js`) were served from
disk by upstream `@backstage/backend-dynamic-feature-service` with
`Cache-Control: public, max-age=0`, so every warm navigation revalidated
each plugin's entry before the Module Federation runtime could execute it
— one round-trip per plugin gating first render of the app skeleton.

RHDH now rewrites, at serving time only, the entry file name referenced by
each plugin's manifest to a content-addressed name
(`remoteEntry.<sha256[0:16]>.js`, same directory) and serves that URL from
an in-memory registry with `Cache-Control: public, max-age=31536000,
immutable`. The URL changes when the bytes change, so immutable caching is
safe and the warm path becomes zero network requests for entries.

Mechanics: the dynamic-features resolver registers each plugin's
`dist/remoteEntry.js` bytes (plus precomputed brotli/gzip encodings) in a
module-scoped registry during its `for()` hooks, rewrites
`metaData.remoteEntry.name` in the manifest passed to the preload collector,
and returns the same rewrite as the upstream resolver provider's
`customizeManifest` hook so the manifest URL itself is served in-memory
with the hashed name. Because the snapshot generator, `preload.js` hint
hrefs, and the MF runtime all derive the entry URL from that single field,
the rewrite propagates everywhere with no frontend changes; `publicPath:
"auto"` still infers from the manifest URL, so chunk resolution is
untouched. On-disk plugin archives stay canonical (`dist/remoteEntry.js`,
manifests untouched) — this is purely a serving-time concern; no
rhdh-cli / plugin export / packaging changes. The hashed URL is served by
a global middleware registered in `rootHttpRouterServiceFactory`'s
`configure()` (a route mount under `/.backstage/dynamic-features/remotes`
is impossible: the Backstage root router rejects nested mounts).

Registry validation semantics: the hash derives deterministically from the
bytes (identical across restarts, workers, and clusters), and the registry
is the only source for hashed URLs — an unknown plugin or a stale hash
(plugin upgraded, old page still cached) gets a loud 404 with `no-store`,
never different bytes at the same immutable URL. A plugin upgrade produces
a new hash and thus a new URL; a stale page fails until a hard reload,
identical to stale content-hashed chunk names today. Fallback semantics:
the literal `remoteEntry.js` keeps its upstream static serving and
`max-age=0` revalidation, and a plugin whose entry cannot be read is
skipped (warned) and keeps the literal name everywhere.

Considered options: query-string versioning (rejected — query keys are not
part of some CDN/cache key calculations and the URL is not
self-describing); URL-rewrite to disk with `next()` (rejected — cannot
guarantee hash↔bytes consistency for the process lifetime if `dist/`
changes underneath, and wrong bytes would carry an immutable policy). The
memory cost is the sum of entry bytes × ~3 encodings (entries are
typically tens of KB), bounded and startup-only. Default-on without a
config flag: the change is transparent (fallback intact, archives
unchanged) and a flag adds config surface with no rollback benefit.

Consequences: the served manifest now names a hashed entry file (nothing
in RHDH or upstream treats `metaData.remoteEntry.name` as a literal
constant at runtime); a dynamic plugin replacing `core.rootHttpRouter`
(via `ENABLE_CORE_ROOTHTTPROUTER_OVERRIDE`) must re-include
`hashedRemoteEntriesMiddleware` (same note as the other root-stack
middlewares); the middleware runs before the root stack's `compression()`
and terminal-returns, so it negotiates `Accept-Encoding` itself from the
precomputed encodings. CSP is unchanged — same origins, same resource
types.

Root-router overrides degrade to literal names: the rewrite and the
serving must never disagree. Because the middleware is registered by
RHDH's default root-router factory — which `getDefaultServiceFactories`
drops entirely when a dynamic plugin overrides `core.rootHttpRouter`
(e.g. adoption-insights) — the resolver checks the same
`ENABLE_CORE_ROOTHTTPROUTER_OVERRIDE` env var and skips the rewrite and
registration when the override is enabled. Otherwise hashed URLs would
be referenced but not served: the request falls through upstream
`express.static` to the app-backend SPA fallback, which answers 200 with
HTML for the entry URL and every frontend dynamic plugin fails to load.
In override deployments plugins keep the literal `remoteEntry.js`
(upstream static, max-age=0) — exactly the pre-hashing behavior; the
immutable-cache win applies to standard deployments.

Evidence: `packages/backend/src/modules/dynamicFeaturesPreload/remoteEntryHash.ts`,
`.../remoteEntryRegistry.ts`, `packages/backend/src/middleware/hashedRemoteEntries.ts`,
`packages/backend/src/modules/dynamicFeaturesResolver.ts` (resolver
integration), `packages/backend/src/defaultServiceFactories.ts` (wiring).
