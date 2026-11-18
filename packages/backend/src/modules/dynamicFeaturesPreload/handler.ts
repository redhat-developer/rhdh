import type { Router } from 'express';

import { createHash } from 'node:crypto';

import { DYNAMIC_FEATURES_REMOTES_PATH } from './paths';
import type { PreloadStore } from './store';

/**
 * Options for {@link mountPreloadEndpoint} / {@link buildPreloadBody}.
 */
export type PreloadEndpointOptions = {
  /**
   * When true (default), `preload.js` injects N× remoteEntry / sync-chunk
   * `<link rel=preload|modulepreload>` hints. When false, moduleInfo + remotes
   * fetch shim still run, and shared-module modulepreloads are kept, but the
   * per-remote entry/sync stampede is skipped.
   *
   * Config: `dynamicPlugins.frontend.preloadRemotes.enabled`
   */
  preloadRemotesEnabled?: boolean;
};

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
 *    b. Optionally injects preload hints for each remoteEntry and for sync
 *       chunks of exposed modules (never executing anything here). Classic
 *       entries get `<link rel="preload" as="script">`; ESM entries (snapshot
 *       remoteEntryType "module"/"esm", from rhdh-cli's
 *       --shared-esm-runtime emission) get `<link rel="modulepreload">`,
 *       which also pre-compiles the module. Canonical shared-module URLs
 *       (what ESM remote entries' baked relative runtime external
 *       resolves to) are modulepreloaded as well.
 *
 * Remotes data is NOT placed on `window` — nothing in the app or
 * `@backstage/frontend-dynamic-feature-loader` reads it as a global.
 * Snapshot modules are already trimmed to the NFS-filtered exposedModules
 * by the collector, so no runtime match against `exposedModules` is needed.
 */
export function buildPreloadBody(
  store: PreloadStore,
  options: PreloadEndpointOptions = {},
): string {
  const preloadRemotesEnabled = options.preloadRemotesEnabled ?? true;
  const remotesPathJson = JSON.stringify(DYNAMIC_FEATURES_REMOTES_PATH);

  const lines = [
    // --- 1. Prefill MF global snapshot --------------------------------------
    `window.__FEDERATION__ = window.__FEDERATION__ || {};`,
    `window.__FEDERATION__.moduleInfo = Object.assign(`,
    `  window.__FEDERATION__.moduleInfo || {},`,
    `  ${JSON.stringify(store.moduleInfo)}`,
    `);`,
    // --- 2. Fetch shim (+ optional script/preload injection) ----------------
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
  ];

  // Shared-module modulepreloads are always eligible (O(few)); the kill-switch
  // only drops the N× remoteEntry / sync stampede.
  const sharedModulesJson = JSON.stringify(store.sharedModuleUrls);
  const hasSharedModules = store.sharedModuleUrls.length > 0;

  if (preloadRemotesEnabled || hasSharedModules) {
    lines.push(
      `  var frag = document.createDocumentFragment();`,
      `  var seen = {};`,
    );
  }

  if (preloadRemotesEnabled) {
    lines.push(
      // remoteEntry preloads + sync-asset preloads — batch into a fragment
      // so the browser sees a single head mutation instead of N appends.
      `  for (var r = 0; r < remotes.length; r++) {`,
      `    var snap = info[remotes[r].remoteInfo.name];`,
      `    if (!snap || !snap.publicPath) continue;`,
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
      // them so the CORS-mode module fetch matches.
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
      `          frag.appendChild(l);`,
      `        }`,
      `      }`,
      // Sync CSS chunks
      `      var css = (a.css && a.css.sync) || [];`,
      `      for (var k = 0; k < css.length; k++) {`,
      `        var ch = snap.publicPath + css[k];`,
      `        if (!seen[ch]) {`,
      `          seen[ch] = 1;`,
      `          var cl = document.createElement("link");`,
      `          cl.rel = "preload"; cl.href = ch; cl.as = "style";`,
      `          cl.crossOrigin = "";`,
      `          frag.appendChild(cl);`,
      `        }`,
      `      }`,
      `    }`,
      `  }`,
    );
  }

  if (hasSharedModules) {
    lines.push(
      // Canonical shared-module URLs (backend baseUrl-anchored): what the
      // ESM remote entries' baked relative runtime external resolves to —
      // modulepreload so they are fetched and pre-compiled before the
      // first ESM remote entry evaluates.
      `  var sharedModules = ${sharedModulesJson};`,
      `  for (var b = 0; b < sharedModules.length; b++) {`,
      `    var bh = sharedModules[b];`,
      `    if (!seen[bh]) {`,
      `      seen[bh] = 1;`,
      `      var bl = document.createElement("link");`,
      `      bl.rel = "modulepreload"; bl.href = bh;`,
      `      frag.appendChild(bl);`,
      `    }`,
      `  }`,
    );
  }

  if (preloadRemotesEnabled || hasSharedModules) {
    lines.push(`  document.head.appendChild(frag);`);
  }

  lines.push(`})();`);
  return lines.join('\n');
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
  options: PreloadEndpointOptions = {},
): void {
  let cachedBody: string | undefined;
  let cachedETag: string | undefined;

  function ensureBody(): { body: string; etag: string } | undefined {
    if (store.remotes.length === 0) {
      return undefined;
    }
    if (!cachedBody) {
      cachedBody = buildPreloadBody(store, options);
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
