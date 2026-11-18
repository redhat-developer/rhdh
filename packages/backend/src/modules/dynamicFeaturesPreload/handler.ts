import type { LoggerService } from '@backstage/backend-plugin-api';

import type { Router } from 'express';

import { createHash } from 'node:crypto';

import {
  assembleFeaturesBootstrap,
  type FeaturesBootstrapArtifact,
} from './bootstrap';
import {
  DYNAMIC_FEATURES_BOOTSTRAP_SCRIPT_PATH,
  DYNAMIC_FEATURES_REMOTES_PATH,
  featuresBootstrapHashedPath,
} from './paths';
import type { PreloadStore } from './store';

export interface MountPreloadOptions {
  /**
   * When true (default), assemble classic remoteEntries into
   * `features.<hash>.js`, load it from index.html / the stable
   * `features.js` alias, and skip mass remoteEntry/sync `<link rel=preload>`
   * injection in `preload.js`.
   *
   * Falls back to mass preloads when the assembler finds nothing to include.
   */
  featuresBootstrapEnabled?: boolean;
  logger?: LoggerService;
}

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
 *    b. When features bootstrap is inactive: injects preload hints for
 *       each remoteEntry and for sync chunks of exposed modules (never
 *       executing anything here). Classic entries get
 *       `<link rel="preload" as="script">`; ESM entries get
 *       `<link rel="modulepreload">`.
 *    c. When features bootstrap is active: skips remoteEntry/sync JS
 *       preload stampede (those classic entries are already in
 *       `features.<hash>.js`). Still modulepreloads shared `.mjs` URLs
 *       and optionally ESM remoteEntries (not inlined into the classic
 *       bootstrap bundle).
 *
 * Remotes data is NOT placed on `window` — nothing in the app or
 * `@backstage/frontend-dynamic-feature-loader` reads it as a global.
 * Snapshot modules are already trimmed to the NFS-filtered exposedModules
 * by the collector, so no runtime match against `exposedModules` is needed.
 */
function buildPreloadBody(
  store: PreloadStore,
  opts: {
    featuresBootstrapActive: boolean;
    featuresBootstrapHash?: string;
  },
): string {
  const remotesPathJson = JSON.stringify(DYNAMIC_FEATURES_REMOTES_PATH);
  const bootstrapMeta = opts.featuresBootstrapActive
    ? {
        enabled: true,
        hash: opts.featuresBootstrapHash,
        url: featuresBootstrapHashedPath(opts.featuresBootstrapHash!),
        stableUrl: DYNAMIC_FEATURES_BOOTSTRAP_SCRIPT_PATH,
      }
    : { enabled: false };

  const lines: string[] = [
    // --- 1. Prefill MF global snapshot --------------------------------------
    `window.__FEDERATION__ = window.__FEDERATION__ || {};`,
    `window.__FEDERATION__.moduleInfo = Object.assign(`,
    `  window.__FEDERATION__.moduleInfo || {},`,
    `  ${JSON.stringify(store.moduleInfo)}`,
    `);`,
    // Discoverable by operators / debugging; index.html loads features.js
    // as a sibling defer script (not injected here).
    `window.__DYNAMIC_FEATURES_BOOTSTRAP__ = ${JSON.stringify(bootstrapMeta)};`,
    // --- 2. Fetch shim + optional preload injection -------------------------
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

  if (opts.featuresBootstrapActive) {
    // Bootstrap active: no mass remoteEntry/sync JS preload stampede.
    // Still modulepreload ESM remoteEntries (not in the classic bundle)
    // and shared runtime modules; keep sync CSS preload hints.
    lines.push(
      `  var frag = document.createDocumentFragment();`,
      `  var seen = {};`,
      `  for (var r = 0; r < remotes.length; r++) {`,
      `    var snap = info[remotes[r].remoteInfo.name];`,
      `    if (!snap || !snap.publicPath) continue;`,
      `    var isEsm = snap.remoteEntryType === "module" || snap.remoteEntryType === "esm";`,
      `    if (isEsm) {`,
      `      var entryHref = snap.publicPath + snap.remoteEntry;`,
      `      if (!seen[entryHref]) {`,
      `        seen[entryHref] = 1;`,
      `        var l = document.createElement("link");`,
      `        l.rel = "modulepreload"; l.href = entryHref;`,
      `        frag.appendChild(l);`,
      `      }`,
      `      var mods = snap.modules || [];`,
      `      for (var m = 0; m < mods.length; m++) {`,
      `        var a = mods[m].assets;`,
      `        if (!a) continue;`,
      `        var js = (a.js && a.js.sync) || [];`,
      `        for (var j = 0; j < js.length; j++) {`,
      `          var href = snap.publicPath + js[j];`,
      `          if (!seen[href]) {`,
      `            seen[href] = 1;`,
      `            var lj = document.createElement("link");`,
      `            lj.rel = "modulepreload"; lj.href = href;`,
      `            frag.appendChild(lj);`,
      `          }`,
      `        }`,
      `        var css = (a.css && a.css.sync) || [];`,
      `        for (var k = 0; k < css.length; k++) {`,
      `          var ch = snap.publicPath + css[k];`,
      `          if (!seen[ch]) {`,
      `            seen[ch] = 1;`,
      `            var cl = document.createElement("link");`,
      `            cl.rel = "preload"; cl.href = ch; cl.as = "style";`,
      `            cl.crossOrigin = "";`,
      `            frag.appendChild(cl);`,
      `          }`,
      `        }`,
      `      }`,
      `    } else {`,
      // Classic: sync CSS only (remoteEntry lives in features bootstrap;
      // sync JS chunks still network-fetched by MF get() — follow-up).
      `      var mods = snap.modules || [];`,
      `      for (var m = 0; m < mods.length; m++) {`,
      `        var a = mods[m].assets;`,
      `        if (!a) continue;`,
      `        var css = (a.css && a.css.sync) || [];`,
      `        for (var k = 0; k < css.length; k++) {`,
      `          var ch = snap.publicPath + css[k];`,
      `          if (!seen[ch]) {`,
      `            seen[ch] = 1;`,
      `            var cl = document.createElement("link");`,
      `            cl.rel = "preload"; cl.href = ch; cl.as = "style";`,
      `            cl.crossOrigin = "";`,
      `            frag.appendChild(cl);`,
      `          }`,
      `        }`,
      `      }`,
      `    }`,
      `  }`,
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
      `  document.head.appendChild(frag);`,
      `})();`,
    );
  } else {
    // Legacy path: mass preload / modulepreload for every remoteEntry + sync.
    lines.push(
      `  var frag = document.createDocumentFragment();`,
      `  var seen = {};`,
      `  for (var r = 0; r < remotes.length; r++) {`,
      `    var snap = info[remotes[r].remoteInfo.name];`,
      `    if (!snap || !snap.publicPath) continue;`,
      `    var isEsm = snap.remoteEntryType === "module" || snap.remoteEntryType === "esm";`,
      `    var entryHref = snap.publicPath + snap.remoteEntry;`,
      `    if (!seen[entryHref]) {`,
      `      seen[entryHref] = 1;`,
      `      var l = document.createElement("link");`,
      `      if (isEsm) { l.rel = "modulepreload"; l.href = entryHref; }`,
      `      else { l.rel = "preload"; l.href = entryHref; l.as = "script"; }`,
      `      frag.appendChild(l);`,
      `    }`,
      `    var mods = snap.modules || [];`,
      `    for (var m = 0; m < mods.length; m++) {`,
      `      var a = mods[m].assets;`,
      `      if (!a) continue;`,
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
      `  document.head.appendChild(frag);`,
      `})();`,
    );
  }

  return lines.join('\n');
}

/**
 * Compute a content hash (8 hex chars) for use as an ETag.
 */
function contentHash(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 8);
}

function sendJs(
  req: { headers: Record<string, unknown> },
  res: {
    setHeader: (k: string, v: string) => void;
    status: (n: number) => { end: () => void };
    send: (body: string) => void;
  },
  body: string,
  etag: string,
  cacheControl: string,
): void {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('ETag', etag);
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.send(body);
}

/**
 * Mount the preload + features-bootstrap endpoints on the given router.
 *
 * ## Caching
 * - `preload.js`: `Cache-Control: no-cache` + content-hash ETag (revalidate).
 * - `features.js`: same revalidation model (stable URL for index.html).
 * - `features.<hash>.js`: `public, max-age=31536000, immutable` when the
 *   path hash matches the assembled body; 404 otherwise.
 *
 * ## Enable / disable
 * Config key (backend): `dynamicPlugins.frontend.featuresBootstrap.enabled`
 * (default `true`). When disabled or when no classic remoteEntries can be
 * assembled, `preload.js` restores the legacy mass `<link rel=preload>`
 * stampede for remoteEntry + sync JS.
 *
 * The store is populated by the upstream remotes router during its startup
 * hook. HTTP requests only arrive after all startup hooks complete, so the
 * store is guaranteed to be ready when these handlers run.
 *
 * `packages/app/public/index.html` must include deferred scripts for
 * both {@link DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH} and
 * {@link DYNAMIC_FEATURES_BOOTSTRAP_SCRIPT_PATH} (preload first).
 */
export function mountPreloadEndpoint(
  router: Router,
  store: PreloadStore,
  options: MountPreloadOptions = {},
): void {
  const featuresBootstrapEnabled = options.featuresBootstrapEnabled !== false;
  const logger = options.logger;

  let cachedPreloadBody: string | undefined;
  let cachedPreloadETag: string | undefined;
  let cachedBootstrap: FeaturesBootstrapArtifact | undefined | null;
  let bootstrapLogged = false;

  function ensureBootstrap(): FeaturesBootstrapArtifact | undefined {
    if (!featuresBootstrapEnabled) {
      return undefined;
    }
    if (cachedBootstrap === null) {
      return undefined;
    }
    if (cachedBootstrap === undefined) {
      if (store.remotes.length === 0) {
        cachedBootstrap = null;
        return undefined;
      }
      const artifact = assembleFeaturesBootstrap(store, logger);
      cachedBootstrap = artifact ?? null;
      if (!bootstrapLogged) {
        bootstrapLogged = true;
        if (artifact) {
          logger?.info(
            `dynamic-features-bootstrap: assembled features.${artifact.hash}.js ` +
              `(${artifact.included.length} classic remoteEntries` +
              `${artifact.skipped.length ? `, ${artifact.skipped.length} skipped` : ''})`,
          );
        } else {
          logger?.info(
            'dynamic-features-bootstrap: no classic remoteEntries to assemble; using mass preload hints',
          );
        }
      }
    }
    return cachedBootstrap ?? undefined;
  }

  function ensurePreload(): { body: string; etag: string } | undefined {
    if (store.remotes.length === 0) {
      return undefined;
    }
    if (!cachedPreloadBody) {
      const bootstrap = ensureBootstrap();
      const featuresBootstrapActive = !!bootstrap;
      cachedPreloadBody = buildPreloadBody(store, {
        featuresBootstrapActive,
        featuresBootstrapHash: bootstrap?.hash,
      });
      cachedPreloadETag = `"${contentHash(cachedPreloadBody)}"`;
    }
    return { body: cachedPreloadBody, etag: cachedPreloadETag! };
  }

  router.get('/preload.js', (req, res) => {
    const result = ensurePreload();
    if (!result) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send('// dynamic-features-preload: no preload data available\n');
      return;
    }
    sendJs(req, res, result.body, result.etag, 'no-cache');
  });

  const emptyBootstrap =
    '// dynamic-features-bootstrap: no features bootstrap available\n';

  router.get('/features.js', (req, res) => {
    const bootstrap = ensureBootstrap();
    if (!bootstrap) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(emptyBootstrap);
      return;
    }
    const etag = `"${bootstrap.hash}"`;
    sendJs(req, res, bootstrap.body, etag, 'no-cache');
  });

  router.get('/features.:hash.js', (req, res) => {
    const bootstrap = ensureBootstrap();
    const requested = req.params.hash;
    if (!bootstrap || requested !== bootstrap.hash) {
      res.status(404).type('text/plain').send('Features bootstrap not found');
      return;
    }
    const etag = `"${bootstrap.hash}"`;
    sendJs(
      req,
      res,
      bootstrap.body,
      etag,
      'public, max-age=31536000, immutable',
    );
  });
}
