import type { LoggerService } from '@backstage/backend-plugin-api';

import type { ProviderModuleInfo } from '@module-federation/sdk';

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { PreloadStore } from './store';

/**
 * Classic remoteEntry concatenation (option 3).
 *
 * Concatenates classic (global/var/window/…) `remoteEntry.js` bodies into a
 * single JS artifact served as `features-remote-entries.<hash>.js`. Evaluating
 * that script registers each container on `window[globalName]`.
 *
 * Module Federation then skips re-downloading those remoteEntries:
 * `@module-federation/runtime-core` `loadEntryScript` calls
 * `getRemoteEntryExports(name, globalName)` first and returns early when the
 * container global is already set. No `createScript` hook is required for
 * classic remotes.
 *
 * Each body is wrapped so `document.currentScript.src` resolves to that
 * remote's real entry URL — required for webpack/rspack `publicPath: "auto"`.
 *
 * Out of scope here (see option 1 / 2):
 * - Inlining expose sync chunks
 * - ESM (`remoteEntryType` "module"/"esm") remote entries
 * - bulk.json MF hooks
 */

export interface ConcatRemoteEntriesArtifact {
  /** Concatenated classic remoteEntry bodies (+ header comment). */
  body: string;
  /** Content hash (16 hex chars) of `body`. */
  hash: string;
  /** packageNames whose remoteEntry was included. */
  included: string[];
  /** Remotes skipped with a short reason. */
  skipped: { packageName: string; reason: string }[];
}

function isProviderSnapshot(value: unknown): value is ProviderModuleInfo {
  return (
    !!value &&
    typeof value === 'object' &&
    'remoteEntry' in value &&
    typeof (value as ProviderModuleInfo).remoteEntry === 'string'
  );
}

function isEsmRemoteEntryType(type: string | undefined): boolean {
  return type === 'module' || type === 'esm';
}

/**
 * Content-hash used in the hashed concat URL and as the stable-alias ETag.
 */
export function hashConcatBody(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 16);
}

/**
 * Resolve `remoteEntry` under `assetsPath`, rejecting path traversal.
 *
 * Absolute `remoteEntry` values are rejected (path.resolve would otherwise
 * ignore `assetsPath`). Symlinks are resolved with realpath and must still
 * stay under the real assets directory.
 */
function resolveRemoteEntryFile(
  assetsPath: string,
  remoteEntry: string,
): string | undefined {
  if (!remoteEntry || path.isAbsolute(remoteEntry)) {
    return undefined;
  }
  const resolvedAssets = path.resolve(assetsPath);
  const resolvedFile = path.resolve(resolvedAssets, remoteEntry);
  if (
    resolvedFile !== resolvedAssets &&
    !resolvedFile.startsWith(resolvedAssets + path.sep)
  ) {
    return undefined;
  }
  try {
    const realAssets = fs.realpathSync(resolvedAssets);
    const realFile = fs.realpathSync(resolvedFile);
    if (
      realFile !== realAssets &&
      !realFile.startsWith(realAssets + path.sep)
    ) {
      return undefined;
    }
    return realFile;
  } catch {
    // Missing path / broken symlink — caller treats as not found.
    return resolvedFile;
  }
}

function snapshotPublicPath(snap: ProviderModuleInfo): string | undefined {
  if ('publicPath' in snap && typeof snap.publicPath === 'string') {
    return snap.publicPath;
  }
  return undefined;
}

/**
 * Wrap one classic remoteEntry body so `document.currentScript` reports the
 * remote's real entry URL while the body runs (publicPath: "auto").
 *
 * The body is left at **script top level** (not inside a function). Webpack
 * MF `library.type: "var"` remotes emit `var <globalName>;…` and rely on
 * classic-script global scope so `window[globalName]` is set. Nesting the
 * body in a function would make that `var` function-local and break
 * `getRemoteEntryExports`.
 *
 * Leading `;` on the setup/teardown IIFEs defends against ASI when the
 * previous chunk omits a trailing semicolon.
 */
function wrapRemoteEntryBody(
  content: string,
  entryUrl: string,
  packageName: string,
  globalName: string,
): string {
  const entryUrlJson = JSON.stringify(entryUrl);
  return [
    `/* --- ${packageName} (globalName=${globalName}) --- */`,
    `;(function(){`,
    `  var __rhdhFake = { src: ${entryUrlJson} };`,
    `  Object.defineProperty(document, "currentScript", {`,
    `    configurable: true,`,
    `    enumerable: false,`,
    `    get: function() { return __rhdhFake; }`,
    `  });`,
    `})();`,
    content,
    `;(function(){ try { delete document.currentScript; } catch (__rhdhE) {} })();`,
  ].join('\n');
}

/**
 * Assemble the concatenated remoteEntries JS from classic remotes in the store.
 *
 * Returns `undefined` when there is nothing to include (empty store, or
 * every remote skipped). Callers should fall back to mass `<link rel=preload>`
 * for remoteEntries in that case.
 */
export function assembleConcatRemoteEntries(
  store: PreloadStore,
  logger?: LoggerService,
): ConcatRemoteEntriesArtifact | undefined {
  const parts: string[] = [
    '/* RHDH dynamic-features: concatenated classic remoteEntry bodies.',
    ' * Registers MF containers on window[globalName] so loadRemote',
    ' * skips per-remote network fetches (getRemoteEntryExports hit).',
    ' * Sync expose chunks are NOT inlined; ESM remotes are skipped.',
    ' * Each body fakes document.currentScript for publicPath: "auto".',
    ' */',
  ];
  const included: string[] = [];
  const skipped: ConcatRemoteEntriesArtifact['skipped'] = [];

  for (const remote of store.remotes) {
    const assetsPath = store.remoteAssetsPaths[remote.packageName];
    if (!assetsPath) {
      skipped.push({
        packageName: remote.packageName,
        reason: 'missing remoteAssetsPaths entry',
      });
      continue;
    }

    const snap = store.moduleInfo[remote.remoteInfo.name];
    if (!isProviderSnapshot(snap)) {
      skipped.push({
        packageName: remote.packageName,
        reason: 'missing ProviderModuleInfo snapshot',
      });
      continue;
    }

    if (isEsmRemoteEntryType(snap.remoteEntryType)) {
      skipped.push({
        packageName: remote.packageName,
        reason: `ESM remoteEntryType=${snap.remoteEntryType} (not concatenated)`,
      });
      continue;
    }

    const publicPath = snapshotPublicPath(snap);
    if (!publicPath) {
      skipped.push({
        packageName: remote.packageName,
        reason: 'missing snapshot publicPath (required for currentScript)',
      });
      continue;
    }

    const filePath = resolveRemoteEntryFile(assetsPath, snap.remoteEntry);
    if (!filePath) {
      skipped.push({
        packageName: remote.packageName,
        reason: `remoteEntry path escapes assets dir (${snap.remoteEntry})`,
      });
      continue;
    }
    if (!fs.existsSync(filePath)) {
      skipped.push({
        packageName: remote.packageName,
        reason: `remoteEntry file not found: ${filePath}`,
      });
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      skipped.push({
        packageName: remote.packageName,
        reason: `failed to read remoteEntry: ${error}`,
      });
      continue;
    }

    const globalName = snap.globalName || remote.remoteInfo.name;
    const entryUrl = `${publicPath}${snap.remoteEntry}`;
    parts.push(
      '',
      wrapRemoteEntryBody(content, entryUrl, remote.packageName, globalName),
    );
    included.push(remote.packageName);
  }

  for (const s of skipped) {
    logger?.debug?.(
      `dynamic-features-concat-remote-entries: skipped '${s.packageName}': ${s.reason}`,
    );
  }

  if (included.length === 0) {
    return undefined;
  }

  const body = `${parts.join('\n')}\n`;
  return {
    body,
    hash: hashConcatBody(body),
    included,
    skipped,
  };
}
