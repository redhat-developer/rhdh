import type { LoggerService } from '@backstage/backend-plugin-api';
import type { ProviderModuleInfo } from '@module-federation/sdk';

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { PreloadStore } from './store';

/**
 * Features bootstrap assembler (option 1, v1).
 *
 * Concatenates classic (global/var/window/…) `remoteEntry.js` bodies into a
 * single JS artifact served as `features.<hash>.js`. Evaluating that script
 * registers each container on `window[globalName]` (or
 * `__FEDERATION_${name}:custom__`).
 *
 * Module Federation then skips re-downloading those remoteEntries:
 * `@module-federation/runtime-core` `loadEntryScript` calls
 * `getRemoteEntryExports(name, globalName)` first and returns early when
 * `CurrentGlobal[remoteEntryKey]` is already set. No `createScript` hook is
 * required for classic remotes.
 *
 * Deferred (not in this file):
 * - Inlining expose sync chunks (chunk-id / publicPath collisions).
 * - ESM (`remoteEntryType` "module"/"esm") remote entries — they need
 *   native `import()`, not classic script concat.
 */

export interface FeaturesBootstrapArtifact {
  /** Concatenated classic remoteEntry bodies (+ header comment). */
  body: string;
  /** Content hash (16 hex chars) of `body`. */
  hash: string;
  /** packageNames whose remoteEntry was included. */
  included: string[];
  /** Remotes skipped with a short reason. */
  skipped: { packageName: string; reason: string }[];
}

function isProviderSnapshot(
  value: unknown,
): value is ProviderModuleInfo {
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
 * Content-hash used in the hashed features URL and as the stable-alias ETag.
 */
export function hashFeaturesBody(body: string): string {
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

/**
 * Assemble the features bootstrap JS from classic remotes in the store.
 *
 * Returns `undefined` when there is nothing to include (empty store, or
 * every remote skipped). Callers should fall back to mass `<link rel=preload>`
 * hints in that case.
 */
export function assembleFeaturesBootstrap(
  store: PreloadStore,
  logger?: LoggerService,
): FeaturesBootstrapArtifact | undefined {
  const parts: string[] = [
    '/* RHDH dynamic-features bootstrap: classic remoteEntry bodies.',
    ' * Registers MF containers on window[globalName] so loadRemote',
    ' * skips per-remote network fetches (getRemoteEntryExports hit).',
    ' * Sync expose chunks are NOT inlined (follow-up); ESM remotes skipped.',
    ' */',
  ];
  const included: string[] = [];
  const skipped: FeaturesBootstrapArtifact['skipped'] = [];

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
        reason: `ESM remoteEntryType=${snap.remoteEntryType} (not inlined)`,
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
    // Leading `;` defends against ASI hazards when the previous chunk omits a
    // trailing semicolon before a `(`/`[`/` line (classic script concat).
    parts.push(
      '',
      `/* --- ${remote.packageName} (globalName=${globalName}) --- */`,
      `;${content}`,
    );
    included.push(remote.packageName);
  }

  for (const s of skipped) {
    logger?.debug?.(
      `dynamic-features-bootstrap: skipped '${s.packageName}': ${s.reason}`,
    );
  }

  if (included.length === 0) {
    return undefined;
  }

  const body = `${parts.join('\n')}\n`;
  return {
    body,
    hash: hashFeaturesBody(body),
    included,
    skipped,
  };
}
