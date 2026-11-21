import type { LoggerService } from '@backstage/backend-plugin-api';
import type { JsonObject } from '@backstage/types';

import { generateSnapshotFromManifest } from '@module-federation/sdk';
import type { Manifest } from '@module-federation/sdk';

import { dynamicFeaturesRemoteManifestPath } from './paths';
import type { PreloadStore } from './store';

/**
 * Collect one plugin's preload data into the store.
 *
 * Called from the composed resolver's `overrideExposedModules` hook,
 * after NFS filtering has produced the final exposedModules list.
 *
 * Only `remotes` and `moduleInfo` are populated here. Snapshot modules
 * are trimmed to the filtered exposedModules list so they stay
 * consistent. The preload handler derives remoteEntry and sync-asset
 * preload hints (or modulepreload hints for ESM-built remotes) at render
 * time by walking these structures — no separate URL lists are needed.
 * The shared MF runtime modulepreload URLs are populated by the
 * resolver's runtime-file scan, not here.
 *
 * Remotes `entry`, snapshot `version`, and `publicPath` are stored as
 * root-relative paths (`/.backstage/…`) so preload.js does not repeat
 * the backend hostname for every plugin.
 */
export function collectPluginPreload(
  store: PreloadStore,
  pluginName: string,
  manifest: JsonObject,
  filteredExposedModules: string[],
  logger: LoggerService,
): void {
  const manifestName = manifest.name as string;
  if (!manifestName) {
    logger.warn(
      `dynamic-features-preload: cannot collect preload for '${pluginName}': missing manifest.name`,
    );
    return;
  }

  const entryPath = dynamicFeaturesRemoteManifestPath(pluginName);

  // Build the remotes list entry (same shape as GET /remotes response).
  // No remoteInfo.type marking is needed — for manifest-based remotes the
  // runtime's snapshot plugin assigns remoteInfo.type from the snapshot's
  // remoteEntryType (which generateSnapshotFromManifest derives from
  // metaData.remoteEntry.type), driving the native import() path.
  store.remotes.push({
    packageName: pluginName,
    remoteInfo: {
      name: manifestName,
      entry: entryPath,
    },
    exposedModules: filteredExposedModules,
  });

  // Build the MF snapshot.
  // Pass version=entryPath so that:
  //   - name-only keys work (snapshot.version matches remotesInfo.matchedVersion)
  //   - publicPath: "auto" resolves via inferAutoPublicPath(entryPath) to a
  //     root-relative directory (same origin as the page)
  try {
    const snapshot = generateSnapshotFromManifest(
      manifest as unknown as Manifest,
      { version: entryPath },
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
