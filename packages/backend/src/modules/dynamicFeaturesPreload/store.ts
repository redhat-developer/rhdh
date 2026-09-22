import type { GlobalModuleInfo } from '@module-federation/sdk';

/**
 * Shape of a single remote as served by
 * GET remotes (see DYNAMIC_FEATURES_REMOTES_PATH)
 */
export interface FrontendPluginRemote {
  packageName: string;
  remoteInfo: {
    name: string;
    entry: string;
  };
  exposedModules: string[];
}

/**
 * Mutable store populated during the upstream remotes initialization (via the
 * resolver provider hooks) and read by the preload endpoint.
 *
 * The store starts empty. The upstream remotes router populates it
 * during its startup hook by calling `provider.for()` for each
 * frontend plugin. HTTP requests only arrive after all startup hooks
 * complete, so the store is guaranteed to be fully populated by the
 * time any request handler reads it.
 *
 * An empty store (remotes.length === 0) means no frontend plugins
 * were found; the preload endpoint serves a no-op comment in that case.
 *
 * The preload handler derives remoteEntry `<script>` tags and sync-asset
 * `<link rel="preload">` hints directly from `remotes` + `moduleInfo`
 * at render time — no separate URL lists are needed. Snapshot modules
 * are already trimmed to match each remote's exposedModules.
 */
export interface PreloadStore {
  /** Remotes list matching the /remotes JSON shape. */
  remotes: FrontendPluginRemote[];
  /** MF snapshot dictionary keyed by manifest.name. */
  moduleInfo: GlobalModuleInfo;
}

export function createPreloadStore(): PreloadStore {
  return {
    remotes: [],
    moduleInfo: {},
  };
}
