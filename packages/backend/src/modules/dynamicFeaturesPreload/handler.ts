import type { LoggerService } from '@backstage/backend-plugin-api';
import type { Router } from 'express';

import { createHash } from 'node:crypto';

import {
  assembleConcatRemoteEntries,
  type ConcatRemoteEntriesArtifact,
} from './concatRemoteEntries';
import {
  DYNAMIC_FEATURES_CONCAT_REMOTE_ENTRIES_SCRIPT_PATH,
  DYNAMIC_FEATURES_REMOTES_PATH,
  concatRemoteEntriesHashedPath,
} from './paths';
import type { PreloadStore } from './store';

export interface MountPreloadOptions {
  /**
   * When true (default), assemble classic remoteEntries into
   * `features-remote-entries.<hash>.js`, load it from index.html / the
   * stable `features-remote-entries.js` alias, and skip classic
   * remoteEntry `<link rel=preload>` only for remotes included in that
   * concat (skipped classic remotes still get a preload hint).
   *
   * Sync JS/CSS preload hints remain (exposes are not inlined). Falls
   * back to mass remoteEntry preloads when the assembler finds nothing
   * to include.
   */
  concatRemoteEntriesEnabled?: boolean;
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
 *    b. Injects preload hints for remoteEntries and for sync chunks of
 *       exposed modules. Classic remotes whose bodies were concatenated
 *       skip remoteEntry `<link rel=preload>` (they already run via
 *       features-remote-entries.js); classic remotes skipped by the
 *       assembler still get a preload hint. ESM entries keep
 *       modulepreload. Sync JS/CSS hints always remain.
 *
 * Remotes data is NOT placed on `window` — nothing in the app or
 * `@backstage/frontend-dynamic-feature-loader` reads it as a global.
 * Snapshot modules are already trimmed to the NFS-filtered exposedModules
 * by the collector, so no runtime match against `exposedModules` is needed.
 */
function buildPreloadBody(
  store: PreloadStore,
  opts: {
    concatRemoteEntriesActive: boolean;
    concatRemoteEntriesHash?: string;
    /** packageNames whose classic remoteEntry was included in the concat. */
    concatIncludedPackageNames?: string[];
  },
): string {
  const remotesPathJson = JSON.stringify(DYNAMIC_FEATURES_REMOTES_PATH);
  const concatMeta = opts.concatRemoteEntriesActive
    ? {
        enabled: true,
        hash: opts.concatRemoteEntriesHash,
        url: concatRemoteEntriesHashedPath(opts.concatRemoteEntriesHash!),
        stableUrl: DYNAMIC_FEATURES_CONCAT_REMOTE_ENTRIES_SCRIPT_PATH,
      }
    : { enabled: false };
  const concatIncluded: Record<string, 1> = {};
  for (const name of opts.concatIncludedPackageNames ?? []) {
    concatIncluded[name] = 1;
  }

  return [
    // --- 1. Prefill MF global snapshot --------------------------------------
    `window.__FEDERATION__ = window.__FEDERATION__ || {};`,
    `window.__FEDERATION__.moduleInfo = Object.assign(`,
    `  window.__FEDERATION__.moduleInfo || {},`,
    `  ${JSON.stringify(store.moduleInfo)}`,
    `);`,
    // Discoverable by operators / debugging; index.html loads
    // features-remote-entries.js as a sibling defer script (not injected here).
    `window.__DYNAMIC_FEATURES_CONCAT_REMOTE_ENTRIES__ = ${JSON.stringify(concatMeta)};`,
    // --- 2. Fetch shim + preload injection ----------------------------------
    `(function() {`,
    `  var remotesPath = ${remotesPathJson};`,
    `  var remotes = ${JSON.stringify(store.remotes)};`,
    `  var info = window.__FEDERATION__.moduleInfo;`,
    // Only skip classic remoteEntry preload for remotes actually in the concat.
    `  var concatIncluded = ${JSON.stringify(concatIncluded)};`,
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
    // Classic remotes in concatIncluded skip remoteEntry links (bodies
    // already live in features-remote-entries.js); sync JS/CSS remain.
    `  var frag = document.createDocumentFragment();`,
    `  var seen = {};`,
    `  for (var r = 0; r < remotes.length; r++) {`,
    `    var snap = info[remotes[r].remoteInfo.name];`,
    `    if (!snap || !snap.publicPath) continue;`,
    `    var isEsm = snap.remoteEntryType === "module" || snap.remoteEntryType === "esm";`,
    `    var entryHref = snap.publicPath + snap.remoteEntry;`,
    `    var inConcat = !!concatIncluded[remotes[r].packageName];`,
    `    if (!seen[entryHref] && (isEsm || !inConcat)) {`,
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
  ].join('\n');
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
 * Mount the preload + concatenated-remoteEntries endpoints on the given router.
 *
 * ## Caching
 * - `preload.js`: `Cache-Control: no-cache` + content-hash ETag (revalidate).
 * - `features-remote-entries.js`: same revalidation model (stable URL for
 *   index.html).
 * - `features-remote-entries.<hash>.js`: `public, max-age=31536000, immutable`
 *   when the path hash matches the assembled body; 404 otherwise.
 *
 * ## Enable / disable
 * Config key (backend): `dynamicPlugins.frontend.concatRemoteEntries.enabled`
 * (default `true`). When disabled or when no classic remoteEntries can be
 * assembled, `preload.js` restores mass classic remoteEntry
 * `<link rel=preload>` hints.
 *
 * The store is populated by the upstream remotes router during its startup
 * hook. HTTP requests only arrive after all startup hooks complete, so the
 * store is guaranteed to be ready when these handlers run.
 *
 * `packages/app/public/index.html` must include deferred scripts for
 * both {@link DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH} and
 * {@link DYNAMIC_FEATURES_CONCAT_REMOTE_ENTRIES_SCRIPT_PATH} (preload first).
 */
export function mountPreloadEndpoint(
  router: Router,
  store: PreloadStore,
  options: MountPreloadOptions = {},
): void {
  const concatRemoteEntriesEnabled =
    options.concatRemoteEntriesEnabled !== false;
  const logger = options.logger;

  let cachedPreloadBody: string | undefined;
  let cachedPreloadETag: string | undefined;
  let cachedConcat: ConcatRemoteEntriesArtifact | undefined | null;
  let concatLogged = false;

  function ensureConcat(): ConcatRemoteEntriesArtifact | undefined {
    if (!concatRemoteEntriesEnabled) {
      return undefined;
    }
    if (cachedConcat === null) {
      return undefined;
    }
    if (cachedConcat === undefined) {
      if (store.remotes.length === 0) {
        cachedConcat = null;
        return undefined;
      }
      const artifact = assembleConcatRemoteEntries(store, logger);
      cachedConcat = artifact ?? null;
      if (!concatLogged) {
        concatLogged = true;
        if (artifact) {
          logger?.info(
            `dynamic-features-concat-remote-entries: assembled features-remote-entries.${artifact.hash}.js ` +
              `(${artifact.included.length} classic remoteEntries` +
              `${artifact.skipped.length ? `, ${artifact.skipped.length} skipped` : ''})`,
          );
        } else {
          logger?.info(
            'dynamic-features-concat-remote-entries: no classic remoteEntries to assemble; using mass remoteEntry preload hints',
          );
        }
      }
    }
    return cachedConcat ?? undefined;
  }

  function ensurePreload(): { body: string; etag: string } | undefined {
    if (store.remotes.length === 0) {
      return undefined;
    }
    if (!cachedPreloadBody) {
      const concat = ensureConcat();
      const concatRemoteEntriesActive = !!concat;
      cachedPreloadBody = buildPreloadBody(store, {
        concatRemoteEntriesActive,
        concatRemoteEntriesHash: concat?.hash,
        concatIncludedPackageNames: concat?.included,
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

  const emptyConcat =
    '// dynamic-features-concat-remote-entries: no concatenated remoteEntries available\n';

  router.get('/features-remote-entries.js', (req, res) => {
    const concat = ensureConcat();
    if (!concat) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(emptyConcat);
      return;
    }
    const etag = `"${concat.hash}"`;
    sendJs(req, res, concat.body, etag, 'no-cache');
  });

  router.get('/features-remote-entries.:hash.js', (req, res) => {
    const concat = ensureConcat();
    const requested = req.params.hash;
    if (!concat || requested !== concat.hash) {
      res
        .status(404)
        .type('text/plain')
        .send('Concatenated remoteEntries not found');
      return;
    }
    const etag = `"${concat.hash}"`;
    sendJs(
      req,
      res,
      concat.body,
      etag,
      'public, max-age=31536000, immutable',
    );
  });
}
