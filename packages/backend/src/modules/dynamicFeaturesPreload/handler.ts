import type { Router } from 'express';

import { createHash } from 'node:crypto';

import { DYNAMIC_FEATURES_REMOTES_PATH } from './paths';
import type { PreloadStore } from './store';

/**
 * Build the preload.js body from the store contents.
 *
 * Single backend-owned script that does all early dynamic-features work:
 * 1. Prefills `window.__FEDERATION__.moduleInfo` — the MF runtime global
 *    snapshot that lets `@module-federation/runtime-core` skip per-plugin
 *    manifest fetches.
 * 2. In a single IIFE that closes over a local `remotes` array:
 *    a. Installs a `fetch` shim that serves the remotes list without a
 *       network hop when the app later requests the remotes endpoint.
 *    b. Injects preload hints for each remoteEntry and for sync chunks of
 *       exposed modules (never executing anything here). Remotes whose
 *       exposed modules were all filtered away are skipped — their entry
 *       would never be consumed. Classic entries
 *       get `<link rel="preload" as="script">`; ESM entries (snapshot
 *       remoteEntryType "module"/"esm", from rhdh-cli's
 *       --shared-esm-runtime emission) get `<link rel="modulepreload">`,
 *       which also pre-compiles the module. Canonical shared-module URLs
 *       (what ESM remote entries' baked relative runtime external
 *       resolves to) are modulepreloaded FIRST — every ESM entry's
 *       evaluation gates on them. Sync-chunk JS hints are emitted at
 *       `fetchpriority="low"`: chunks are consumed after the app shell
 *       mounts, and high-priority chunk links would preempt the app's
 *       own (deferred, medium-priority) module scripts on
 *       connection-limited transports (HTTP/1.1). Sync CSS chunks keep
 *       the default priority — few, and they style the shell.
 *
 * Remotes data is NOT placed on `window` — nothing in the app or
 * `@backstage/frontend-dynamic-feature-loader` reads it as a global.
 * Snapshot modules are already trimmed to the NFS-filtered exposedModules
 * by the collector, so no runtime match against `exposedModules` is needed.
 */
function buildPreloadBody(store: PreloadStore): string {
  const remotesPathJson = JSON.stringify(DYNAMIC_FEATURES_REMOTES_PATH);

  return [
    // --- 1. Prefill MF global snapshot --------------------------------------
    `window.__FEDERATION__ = window.__FEDERATION__ || {};`,
    `window.__FEDERATION__.moduleInfo = Object.assign(`,
    `  window.__FEDERATION__.moduleInfo || {},`,
    `  ${JSON.stringify(store.moduleInfo)}`,
    `);`,
    // --- 2. Fetch shim + script/preload injection ---------------------------
    `(function() {`,
    `  var remotesPath = ${remotesPathJson};`,
    `  var remotes = ${JSON.stringify(store.remotes)};`,
    `  var info = window.__FEDERATION__.moduleInfo;`,
    // fetch shim: intercept the remotes endpoint and return from local data
    `  var originalFetch = window.fetch;`,
    `  window.fetch = function(input, init) {`,
    `    var url;`,
    `    if (typeof input === "string") { url = input; }`,
    `    else if (input && typeof input.href === "string") { url = input.href; }`,
    `    else if (input && typeof input.url === "string") { url = input.url; }`,
    `    else { url = ""; }`,
    `    if (url.length >= remotesPath.length &&`,
    `        url.slice(-remotesPath.length) === remotesPath) {`,
    `      return Promise.resolve(new Response(JSON.stringify(remotes), {`,
    `        status: 200,`,
    `        headers: { "Content-Type": "application/json" }`,
    `      }));`,
    `    }`,
    `    return originalFetch.apply(this, arguments);`,
    `  };`,
    // remoteEntry preloads + sync-asset preloads — batch into a fragment
    // so the browser sees a single head mutation instead of N appends.
    `  var frag = document.createDocumentFragment();`,
    `  var seen = {};`,
    // --- Shared modules first, at high priority -----------------------------
    // Canonical shared-module URLs (backend baseUrl-anchored): what the
    // ESM remote entries' baked relative runtime external resolves to.
    // Every ESM entry's evaluation gates on these modules, so they must
    // be emitted BEFORE the per-remote links — under connection-limited
    // transports (HTTP/1.1) and real latency, a shared module queued
    // behind all remote entries and chunks delays every ESM plugin.
    `  var sharedModules = ${JSON.stringify(store.sharedModuleUrls)};`,
    `  for (var b = 0; b < sharedModules.length; b++) {`,
    `    var bh = sharedModules[b];`,
    `    if (!seen[bh]) {`,
    `      seen[bh] = 1;`,
    `      var bl = document.createElement("link");`,
    `      bl.rel = "modulepreload"; bl.href = bh;`,
    `      frag.appendChild(bl);`,
    `    }`,
    `  }`,
    `  for (var r = 0; r < remotes.length; r++) {`,
    `    var snap = info[remotes[r].remoteInfo.name];`,
    `    if (!snap || !snap.publicPath) continue;`,
    // A remote whose exposed modules were all filtered away (disabled
    // plugin) is never loadRemote'd by the app — the loader maps over
    // an empty exposedModules list — so its entry preload would be
    // guaranteed waste. Skip hint emission for it entirely.
    `    if (!snap.modules || snap.modules.length === 0) continue;`,
    // ESM entries (rhdh-cli --shared-esm-runtime): modulepreload fetches
    // AND pre-compiles the module graph. Classic entries: preload the
    // script for cache warming only — execution happens later via the MF
    // runtime (loadRemote). Nothing is ever executed here.
    `    var isEsm = snap.remoteEntryType === "module" || snap.remoteEntryType === "esm";`,
    `    var entryHref = snap.publicPath + snap.remoteEntry;`,
    `    if (!seen[entryHref]) {`,
    `      seen[entryHref] = 1;`,
    `      var l = document.createElement("link");`,
    `      if (isEsm) { l.rel = "modulepreload"; l.href = entryHref; }`,
    `      else { l.rel = "preload"; l.href = entryHref; l.as = "script"; }`,
    `      frag.appendChild(l);`,
    `    }`,
    // Walk snapshot modules (already trimmed to exposedModules by collector)
    // to inject preload hints for sync JS/CSS chunks. Sync chunks of ESM
    // remotes are ES modules too (chunkLoading: "import") — modulepreload
    // them so the CORS-mode module fetch matches. JS chunks are consumed
    // after the app shell mounts, so they are warmed at LOW priority:
    // high-priority chunk links would preempt the app's own (deferred,
    // medium-priority) module scripts on connection-limited transports.
    // CSS chunks keep the default priority — see below.
    `    var mods = snap.modules || [];`,
    `    for (var m = 0; m < mods.length; m++) {`,
    `      var a = mods[m].assets;`,
    `      if (!a) continue;`,
    // Sync JS chunks
    `      var js = (a.js && a.js.sync) || [];`,
    `      for (var j = 0; j < js.length; j++) {`,
    `        var href = snap.publicPath + js[j];`,
    `        if (!seen[href]) {`,
    `          seen[href] = 1;`,
    `          var l = document.createElement("link");`,
    `          if (isEsm) { l.rel = "modulepreload"; l.href = href; }`,
    `          else { l.rel = "preload"; l.href = href; l.as = "script"; }`,
    `          l.fetchPriority = "low";`,
    `          frag.appendChild(l);`,
    `        }`,
    `      }`,
    // Sync CSS chunks — kept at default priority: they are few, and they
    // style the shell (e.g. the theme plugin's CSS), so deprioritizing
    // them delays the final painted state. No crossorigin attribute: the
    // plugin runtime inserts its stylesheets without one (no-cors mode),
    // and CORS mode is part of the preload cache key — a cors-mode
    // preload can never be matched by the no-cors stylesheet fetch, so
    // every plugin CSS would be downloaded twice.
    `      var css = (a.css && a.css.sync) || [];`,
    `      for (var k = 0; k < css.length; k++) {`,
    `        var ch = snap.publicPath + css[k];`,
    `        if (!seen[ch]) {`,
    `          seen[ch] = 1;`,
    `          var cl = document.createElement("link");`,
    `          cl.rel = "preload"; cl.href = ch; cl.as = "style";`,
    `          frag.appendChild(cl);`,
    `        }`,
    `      }`,
    `    }`,
    `  }`,
    `  document.head.appendChild(frag);`,
    `})();`,
  ].join('\n');
}

/**
 * Compute a content hash (8 hex chars) for use as an ETag.
 */
function contentHash(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 8);
}

/**
 * Mount the preload endpoint on the given router.
 *
 * Serves `preload.js` with revalidation caching:
 *   Cache-Control: no-cache   — browser may cache but must revalidate
 *   ETag: "<content-hash>"    — enables 304 Not Modified on revalidation
 *
 * This is the URL referenced in the app's `index.html`
 * `<script defer src="/.../preload.js">` tag.
 *
 * The store is populated by the upstream remotes router during its startup
 * hook. HTTP requests only arrive after all startup hooks complete, so the
 * store is guaranteed to be ready when this handler runs.
 */
export function mountPreloadEndpoint(
  router: Router,
  store: PreloadStore,
): void {
  let cachedBody: string | undefined;
  let cachedETag: string | undefined;

  function ensureBody(): { body: string; etag: string } | undefined {
    if (store.remotes.length === 0) {
      return undefined;
    }
    if (!cachedBody) {
      cachedBody = buildPreloadBody(store);
      cachedETag = `"${contentHash(cachedBody)}"`;
    }
    return { body: cachedBody, etag: cachedETag! };
  }

  router.get('/preload.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');

    const result = ensureBody();
    if (!result) {
      res.send('// dynamic-features-preload: no preload data available\n');
      return;
    }

    res.setHeader('ETag', result.etag);

    // Support conditional requests: if the client already has this version,
    // respond with 304 and skip sending the body.
    if (req.headers['if-none-match'] === result.etag) {
      res.status(304).end();
      return;
    }

    res.send(result.body);
  });
}
