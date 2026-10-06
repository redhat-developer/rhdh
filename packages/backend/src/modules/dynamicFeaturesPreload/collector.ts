import type { LoggerService } from '@backstage/backend-plugin-api';
import type { JsonObject } from '@backstage/types';

import { generateSnapshotFromManifest } from '@module-federation/sdk';
import type { Manifest } from '@module-federation/sdk';

import {
  DYNAMIC_FEATURES_MANIFEST_FILE,
  DYNAMIC_FEATURES_PLUGIN_ID,
} from './paths';
import type { PreloadStore } from './store';

/**
 * Collect one plugin's preload data into the store.
 *
 * Called from the composed resolver's `overrideExposedModules` hook,
 * after NFS filtering has produced the final exposedModules list.
 *
 * Only `remotes` and `moduleInfo` are populated here. Snapshot modules are
 * trimmed to the filtered exposedModules list so they stay consistent.
 * The preload handler derives remoteEntry `<script>` tags and sync-asset
 * `<link rel="preload">` hints at render time by walking these two
 * structures — no separate URL lists are needed.
 */
export function collectPluginPreload(
  store: PreloadStore,
  pluginName: string,
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

  // Build the remotes list entry (same shape as GET /remotes response)
  store.remotes.push({
    packageName: pluginName,
    remoteInfo: {
      name: manifestName,
      entry: entryUrl,
    },
    exposedModules: filteredExposedModules,
  });

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
