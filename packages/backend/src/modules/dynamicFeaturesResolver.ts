import { dynamicPluginsFrontendServiceRef } from '@backstage/backend-dynamic-feature-service';
import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import type { JsonObject } from '@backstage/types';

import { Router } from 'express';

import { collectPluginPreload } from './dynamicFeaturesPreload/collector';
import { mountPreloadEndpoint } from './dynamicFeaturesPreload/handler';
import {
  DYNAMIC_FEATURES_PRELOAD_BASE_PATH,
  DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH,
  DYNAMIC_FEATURES_SHARED_ASSETS_BASE_PATH,
} from './dynamicFeaturesPreload/paths';
import {
  registerRemoteEntry,
  remoteEntryRegistry,
} from './dynamicFeaturesPreload/remoteEntryRegistry';
import { createPreloadStore } from './dynamicFeaturesPreload/store';
import {
  filterNfsExposedModules,
  readBackstageFeatures,
} from './nfsModuleFilter';
import {
  registerSharedAssets,
  SHARED_ASSET_IMMUTABLE_CACHE_CONTROL,
  SHARED_ASSET_REVALIDATE_CACHE_CONTROL,
  type SharedAssetRegistry,
} from './sharedAssets';

/**
 * Router serving registered shared assets at `/:filename`. The
 * registry is the allowlist: unregistered names get a loud 404, and
 * registered ones are served from the in-memory snapshot — no
 * per-request filesystem access (the app-backend serves its static
 * assets the same way). Cache class per asset, verified at
 * registration: names that carry their own content hash are served
 * immutable (the URL cannot be reused for different bytes without
 * failing the registration check); everything else revalidates every
 * use — Express generates a content ETag for res.send bodies and
 * answers conditional requests with 304 automatically. Range requests
 * are not supported (shared modules and assets are not range-fetched).
 */
function createSharedAssetsRouter(sharedAssets: SharedAssetRegistry) {
  const router = Router();
  router.get('/:filename', (req, res) => {
    const sharedAsset = sharedAssets.get(req.params.filename);
    if (!sharedAsset) {
      res.status(404).send('Shared dynamic-plugin asset not found');
      return;
    }
    res.type(req.params.filename);
    res.setHeader(
      'Cache-Control',
      sharedAsset.immutable
        ? SHARED_ASSET_IMMUTABLE_CACHE_CONTROL
        : SHARED_ASSET_REVALIDATE_CACHE_CONTROL,
    );
    res.send(sharedAsset.content);
  });
  return router;
}

/**
 * Backend plugin that registers the single FrontendRemoteResolverProvider:
 *
 * 1. Filters exposed modules to NFS entrypoints (FrontendPlugin / FrontendModule)
 * 2. Collects MF snapshot data for each plugin into a shared store
 * 3. Mounts a CSP-safe `preload.js` endpoint that prefills MF globals,
 *    shims the remotes fetch, and injects remoteEntry / sync-asset
 *    preload hints (or modulepreload hints for ESM-built remotes — never
 *    executing remoteEntry scripts)
 * 4. Registers the shared assets embedded in each plugin's flat
 *    `dist/shared/` directory (any file type; currently the
 *    self-contained ESM shared MF runtime module embedded by
 *    `rhdh-cli plugin export --shared-esm-runtime`), serves them from
 *    an in-memory registry snapshot at
 *    `/.backstage/dynamic-features-shared-modules/<filename>`, and
 *    collects every `.mjs` file's URL for `preload.js`
 *    modulepreloading. The first plugin carrying a given file name
 *    provides it; files with the same name must be content-identical
 *    (a conflict fails the conflicting plugin — see `sharedAssets.ts`).
 * 5. Registers each plugin's `dist/remoteEntry.js` bytes in the
 *    content-hashed remote-entry registry and rewrites the served
 *    manifest's `metaData.remoteEntry.name` to the hashed file name
 *    (`remoteEntry.<sha256[0:16]>.js`). The hashed URL is served
 *    immutable by the global `hashedRemoteEntriesMiddleware`
 *    (see `middleware/hashedRemoteEntries.ts`), eliminating the
 *    warm-cache 304 revalidation burst for entries.
 *
 * The app's `index.html` must include a deferred script pointing at
 * DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH.
 */
export const dynamicFeaturesResolver = createBackendPlugin({
  pluginId: 'dynamic-features-resolver',
  register(reg) {
    reg.registerInit({
      deps: {
        frontendRemotes: dynamicPluginsFrontendServiceRef,
        rootHttpRouter: coreServices.rootHttpRouter,
        config: coreServices.rootConfig,
        logger: coreServices.rootLogger,
      },
      async init({ frontendRemotes, rootHttpRouter, config, logger }) {
        const backendBaseUrl = config.getString('backend.baseUrl');
        const store = createPreloadStore();
        const sharedAssets: SharedAssetRegistry = new Map();

        frontendRemotes.setResolverProvider({
          for(pluginName, pluginPackagePath) {
            registerSharedAssets(
              sharedAssets,
              store,
              pluginPackagePath,
              pluginName,
              backendBaseUrl,
              logger,
            );
            registerRemoteEntry(
              remoteEntryRegistry,
              pluginName,
              pluginPackagePath,
              logger,
            );
            const features = readBackstageFeatures(
              pluginName,
              pluginPackagePath,
              logger,
            );

            /**
             * Serving-time manifest rewrite: point
             * `metaData.remoteEntry.name` at the content-hashed entry
             * file served by `hashedRemoteEntriesMiddleware`. The
             * snapshot generator, preload.js hrefs, and the MF runtime
             * all derive the entry URL from this field, so the rewrite
             * propagates everywhere; `path` stays `""` and `type` is
             * preserved (remoteEntryType derives from it). Unregistered
             * plugins (unreadable entry) keep the literal name — the
             * fallback path is unchanged.
             */
            const rewriteManifest = (manifest: JsonObject): JsonObject => {
              const record = remoteEntryRegistry.get(pluginName);
              if (!record) {
                return manifest;
              }
              const metaData = (manifest.metaData ?? {}) as JsonObject;
              const remoteEntry = (metaData.remoteEntry ?? {}) as JsonObject;
              return {
                ...manifest,
                metaData: {
                  ...metaData,
                  remoteEntry: { ...remoteEntry, name: record.hashedName },
                },
              };
            };

            return {
              overrideExposedModules(exposed, manifest) {
                const filtered = filterNfsExposedModules(
                  pluginName,
                  exposed,
                  manifest,
                  features,
                  logger,
                );
                collectPluginPreload(
                  store,
                  pluginName,
                  rewriteManifest(manifest),
                  filtered,
                  backendBaseUrl,
                  logger,
                );
                return filtered;
              },
              // Served in-memory at the manifest URL by the upstream
              // router — covers the no-prefill fallback path and
              // direct debugging.
              customizeManifest: rewriteManifest,
            };
          },
        });

        const preloadRouter = Router();
        mountPreloadEndpoint(preloadRouter, store);
        rootHttpRouter.use(DYNAMIC_FEATURES_PRELOAD_BASE_PATH, preloadRouter);

        logger.info(
          `dynamic-features-resolver: preload endpoint at ${DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH}`,
        );

        // Serve directly from the first plugin carrying a given shared
        // file. The route is mounted even when the registry is empty so
        // missing files return the designed loud 404.
        rootHttpRouter.use(
          DYNAMIC_FEATURES_SHARED_ASSETS_BASE_PATH,
          createSharedAssetsRouter(sharedAssets),
        );
        logger.info(
          `dynamic-features-resolver: shared assets route at ${DYNAMIC_FEATURES_SHARED_ASSETS_BASE_PATH} (served from an in-memory snapshot of plugin dist/shared directories)`,
        );
      },
    });
  },
});
