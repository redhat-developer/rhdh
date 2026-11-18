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
 * The preload handler derives remoteEntry and sync-asset `<link
 * rel="preload">` hints directly from `remotes` + `moduleInfo` at render
 * time — no separate URL lists are needed. Snapshot modules are already
 * trimmed to match each remote's exposedModules.
 *
 * `remoteAssetsPaths` maps each remote's `packageName` to the on-disk
 * assets directory (typically `<pluginPackagePath>/dist`) so the
 * features bootstrap assembler can read `remoteEntry.js` bodies.
 */
export interface PreloadStore {
  /** Remotes list matching the /remotes JSON shape. */
  remotes: FrontendPluginRemote[];
  /** MF snapshot dictionary keyed by manifest.name. */
  moduleInfo: GlobalModuleInfo;
  /**
   * Absolute filesystem path of each remote's static assets directory
   * (the directory that contains `remoteEntry.js` / `mf-manifest.json`),
   * keyed by remotes `packageName`.
   */
  remoteAssetsPaths: Record<string, string>;
  /**
   * Canonical URLs of shared dynamic-plugin `.mjs` modules (deduped).
   *
   * ESM remote entries exported with `rhdh-cli plugin export
   * --shared-esm-runtime` externalize their MF runtime through a static
   * relative specifier baked at export time, which resolves against the
   * remoteEntry's own URL to the canonical shared-assets URL (backend
   * baseUrl-anchored). Identical runtime bytes produce the same
   * canonical URL, so all plugins built with the same toolchain import
   * the same resolved URL and share a single fetched and evaluated
   * module instance. This list — populated by the resolver's scan of
   * each deployed plugin's flat `dist/shared/` directory (`.mjs` files
   * only) — is modulepreloaded by preload.js, warming exactly the URLs
   * the runtime externals resolve to.
   */
  sharedModuleUrls: string[];
}

export function createPreloadStore(): PreloadStore {
  return {
    remotes: [],
    moduleInfo: {},
    remoteAssetsPaths: {},
    sharedModuleUrls: [],
  };
}
