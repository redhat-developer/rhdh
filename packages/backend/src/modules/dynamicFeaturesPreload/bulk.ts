import type { LoggerService } from '@backstage/backend-plugin-api';
import type { ProviderModuleInfo } from '@module-federation/sdk';

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { PreloadStore } from './store';

/**
 * Bulk remote-entries payload (option 2, v1).
 *
 * One JSON response keyed by absolute public URL so the app can:
 * 1. Evaluate classic `remoteEntry` sources (so `window[globalName]` exists
 *    before `loadRemote` — MF `getRemoteEntryExports` short-circuits).
 * 2. Register MF `createScript` / `fetch` hooks that serve mapped URLs
 *    from memory (remoteEntries + expose sync JS chunks).
 *
 * ESM (`remoteEntryType` "module"/"esm") remotes are skipped here — they
 * need native `import()` / modulepreload, not classic eval. Sync CSS is
 * not included (still handled via preload hints when useful).
 */

export interface BulkRemoteEntriesPayload {
  /** Schema version for the client. */
  version: 1;
  /**
   * Absolute public URL → JS source text.
   * Includes classic remoteEntries and (when readable) expose sync chunks.
   */
  sources: Record<string, string>;
  /**
   * Subset of `sources` keys that are classic remoteEntry URLs.
   * Client must evaluate these (and only these) before `loadRemote`.
   */
  evaluate: string[];
}

export interface BulkRemoteEntriesArtifact {
  payload: BulkRemoteEntriesPayload;
  /** Serialized JSON body served at `/bulk.json`. */
  body: string;
  /** Content hash (16 hex chars) of `body`. */
  hash: string;
  includedRemoteEntries: string[];
  includedSyncChunkUrls: string[];
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

function hasPublicPath(
  snap: ProviderModuleInfo,
): snap is ProviderModuleInfo & { publicPath: string } {
  return 'publicPath' in snap && typeof snap.publicPath === 'string';
}

/**
 * Content-hash used as the bulk.json ETag.
 */
export function hashBulkBody(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 16);
}

/**
 * Resolve a relative asset under `assetsPath`, rejecting path traversal.
 */
function resolveAssetFile(
  assetsPath: string,
  relativePath: string,
): string | undefined {
  if (!relativePath || path.isAbsolute(relativePath)) {
    return undefined;
  }
  const resolvedAssets = path.resolve(assetsPath);
  const resolvedFile = path.resolve(resolvedAssets, relativePath);
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
    // Missing file / unreadable symlink: do not fall back to the
    // unresolved path (avoids following a later-created escape symlink).
    return undefined;
  }
}

function readAsset(
  assetsPath: string,
  relativePath: string,
): { ok: true; content: string } | { ok: false; reason: string } {
  const filePath = resolveAssetFile(assetsPath, relativePath);
  if (!filePath) {
    return {
      ok: false,
      reason: `path escapes assets dir (${relativePath})`,
    };
  }
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: `file not found: ${filePath}` };
  }
  try {
    return { ok: true, content: fs.readFileSync(filePath, 'utf8') };
  } catch (error) {
    return { ok: false, reason: `failed to read: ${error}` };
  }
}

/**
 * Assemble the bulk URL→source map from classic remotes in the store.
 *
 * Returns `undefined` when there is nothing to include (empty store, or
 * every remote skipped). Callers should fall back to mass `<link rel=preload>`
 * hints in that case.
 */
export function assembleBulkRemoteEntries(
  store: PreloadStore,
  logger?: LoggerService,
): BulkRemoteEntriesArtifact | undefined {
  const sources: Record<string, string> = {};
  const evaluate: string[] = [];
  const includedRemoteEntries: string[] = [];
  const includedSyncChunkUrls: string[] = [];
  const skipped: BulkRemoteEntriesArtifact['skipped'] = [];

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
    if (!isProviderSnapshot(snap) || !hasPublicPath(snap)) {
      skipped.push({
        packageName: remote.packageName,
        reason: 'missing ProviderModuleInfo snapshot with publicPath',
      });
      continue;
    }

    if (isEsmRemoteEntryType(snap.remoteEntryType)) {
      skipped.push({
        packageName: remote.packageName,
        reason: `ESM remoteEntryType=${snap.remoteEntryType} (not in bulk eval map)`,
      });
      continue;
    }

    const entryUrl = `${snap.publicPath}${snap.remoteEntry}`;
    const entryRead = readAsset(assetsPath, snap.remoteEntry);
    if (!entryRead.ok) {
      skipped.push({
        packageName: remote.packageName,
        reason: `remoteEntry ${entryRead.reason}`,
      });
      continue;
    }

    sources[entryUrl] = entryRead.content;
    evaluate.push(entryUrl);
    includedRemoteEntries.push(remote.packageName);

    // Expose sync JS chunks: include in the map for createScript/fetch hooks.
    // Do NOT add to `evaluate` — webpack chunk loading must stay under MF control.
    for (const mod of snap.modules ?? []) {
      const syncJs = mod.assets?.js?.sync ?? [];
      for (const rel of syncJs) {
        const chunkUrl = `${snap.publicPath}${rel}`;
        if (sources[chunkUrl] !== undefined) {
          continue;
        }
        const chunkRead = readAsset(assetsPath, rel);
        if (!chunkRead.ok) {
          logger?.debug?.(
            `dynamic-features-bulk: skipped sync chunk '${rel}' of '${remote.packageName}': ${chunkRead.reason}`,
          );
          continue;
        }
        sources[chunkUrl] = chunkRead.content;
        includedSyncChunkUrls.push(chunkUrl);
      }
    }
  }

  for (const s of skipped) {
    logger?.debug?.(
      `dynamic-features-bulk: skipped '${s.packageName}': ${s.reason}`,
    );
  }

  if (evaluate.length === 0) {
    return undefined;
  }

  const payload: BulkRemoteEntriesPayload = {
    version: 1,
    sources,
    evaluate,
  };
  const body = `${JSON.stringify(payload)}\n`;
  return {
    payload,
    body,
    hash: hashBulkBody(body),
    includedRemoteEntries,
    includedSyncChunkUrls,
    skipped,
  };
}
