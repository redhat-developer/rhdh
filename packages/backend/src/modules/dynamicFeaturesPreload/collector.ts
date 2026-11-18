import type { LoggerService } from '@backstage/backend-plugin-api';
import type { JsonObject } from '@backstage/types';

import { generateSnapshotFromManifest } from '@module-federation/sdk';
import type { Manifest } from '@module-federation/sdk';

import path from 'node:path';

import {
  DYNAMIC_FEATURES_MANIFEST_FILE,
  DYNAMIC_FEATURES_PLUGIN_ID,
  REMOTE_ASSETS_PATH_FROM_PACKAGE,
} from './paths';
import type { PreloadStore } from './store';

/**
 * Collect one plugin's preload data into the store.
 *
 * Called from the composed resolver's `overrideExposedModules` hook,
 * after NFS filtering has produced the final exposedModules list.
 *
 * Populates `remotes`, `moduleInfo`, and `remoteAssetsPaths`. Snapshot
 * modules are trimmed to the filtered exposedModules list so they stay
 * consistent. The preload handler derives remoteEntry and sync-asset
 * preload hints (or modulepreload hints for ESM-built remotes) at render
 * time by walking these structures — no separate URL lists are needed.
 * The shared MF runtime modulepreload URLs are populated by the
 * resolver's runtime-file scan, not here.
 *
 * `remoteAssetsPaths` records `<pluginPackagePath>/dist` so the features
 * bootstrap assembler can read classic `remoteEntry.js` bodies from disk.
 */
export function collectPluginPreload(
  store: PreloadStore,
  pluginName: string,
  pluginPackagePath: string,
  manifest: JsonObject,
  filteredExposedModules: string[],
  backendBaseUrl: string,
  logger: LoggerService,
): void {
  const manifestName = manifest.name as string;
  if (!manifestName) {
    logger.warn(
      `dynamic-features-preload: cannot collect preload for '${pluginName}': missing manifest.name`,
    );
    return;
  }

  const entryUrl = `${backendBaseUrl}/${DYNAMIC_FEATURES_PLUGIN_ID}/remotes/${pluginName}/${DYNAMIC_FEATURES_MANIFEST_FILE}`;

  // Build the remotes list entry (same shape as GET /remotes response).
  // No remoteInfo.type marking is needed — for manifest-based remotes the
  // runtime's snapshot plugin assigns remoteInfo.type from the snapshot's
  // remoteEntryType (which generateSnapshotFromManifest derives from
  // metaData.remoteEntry.type), driving the native import() path.
  store.remotes.push({
    packageName: pluginName,
    remoteInfo: {
      name: manifestName,
      entry: entryUrl,
    },
    exposedModules: filteredExposedModules,
  });

  store.remoteAssetsPaths[pluginName] = path.resolve(
    pluginPackagePath,
    REMOTE_ASSETS_PATH_FROM_PACKAGE,
  );

  // Build the MF snapshot.
  // Pass version=entryUrl so that:
  //   - name-only keys work (snapshot.version matches remotesInfo.matchedVersion)
  //   - publicPath: "auto" resolves via inferAutoPublicPath(entryUrl)
  try {
    const snapshot = generateSnapshotFromManifest(
      manifest as unknown as Manifest,
      { version: entryUrl },
    );
    // Keep snapshot.modules aligned with NFS-filtered exposedModules so
    // preload.js only carries (and can only preload) modules RHDH will load.
    const exposed = new Set(filteredExposedModules);
    snapshot.modules = snapshot.modules.filter(m => exposed.has(m.moduleName));
    store.moduleInfo[manifestName] = snapshot;
  } catch (error) {
    logger.warn(
      `dynamic-features-preload: failed to generate snapshot for '${pluginName}': ${error}`,
    );
  }
}
