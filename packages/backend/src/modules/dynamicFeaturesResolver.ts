import { dynamicPluginsFrontendServiceRef } from '@backstage/backend-dynamic-feature-service';
import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';

import { Router } from 'express';

import { collectPluginPreload } from './dynamicFeaturesPreload/collector';
import { mountPreloadEndpoint } from './dynamicFeaturesPreload/handler';
import {
  DYNAMIC_FEATURES_BOOTSTRAP_SCRIPT_PATH,
  DYNAMIC_FEATURES_PRELOAD_BASE_PATH,
  DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH,
  DYNAMIC_FEATURES_SHARED_ASSETS_BASE_PATH,
} from './dynamicFeaturesPreload/paths';
import { createPreloadStore } from './dynamicFeaturesPreload/store';
import {
  filterNfsExposedModules,
  readBackstageFeatures,
} from './nfsModuleFilter';
import { registerSharedAssets } from './sharedAssets';
import type { SharedAssetRegistry } from './sharedAssets';

/**
 * Router serving registered shared assets at `/:filename`. The
 * registry is the allowlist: unregistered names get a loud 404, and
 * registered ones are served from the in-memory snapshot — no
 * per-request filesystem access (the app-backend serves its static
 * assets the same way). Express generates a content ETag for res.send
 * bodies and answers conditional requests with 304 automatically;
 * range requests are not supported (shared modules and assets are not
 * range-fetched).
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
 *    shims the remotes fetch, and (when features bootstrap is off)
 *    injects remoteEntry / sync-asset preload hints (or modulepreload
 *    hints for ESM-built remotes — never executing remoteEntry scripts
 *    from preload.js itself)
 * 4. Assembles a content-hashed `features.<hash>.js` bootstrap of classic
 *    remoteEntry bodies (default on; config
 *    `dynamicPlugins.frontend.featuresBootstrap.enabled`) so cold start
 *    does not need O(N) remoteEntry fetches — MF `getRemoteEntryExports`
 *    hits the already-registered `window[globalName]`
 * 5. Registers the shared assets embedded in each plugin's flat
 *    `dist/shared/` directory (any file type; currently the
 *    self-contained ESM shared MF runtime module embedded by
 *    `rhdh-cli plugin export --shared-esm-runtime`), serves them from
 *    an in-memory registry snapshot at
 *    `/.backstage/dynamic-features-shared-modules/<filename>`, and
 *    collects every `.mjs` file's URL for `preload.js`
 *    modulepreloading. The first plugin carrying a given file name
 *    provides it; files with the same name must be content-identical
 *    (a conflict fails the conflicting plugin — see `sharedAssets.ts`).
 *
 * The app's `index.html` must include deferred scripts pointing at
 * DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH then
 * DYNAMIC_FEATURES_BOOTSTRAP_SCRIPT_PATH (order matters).
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
        const featuresBootstrapEnabled =
          config.getOptionalBoolean(
            'dynamicPlugins.frontend.featuresBootstrap.enabled',
          ) ?? true;

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
            const features = readBackstageFeatures(
              pluginName,
              pluginPackagePath,
              logger,
            );
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
                  pluginPackagePath,
                  manifest,
                  filtered,
                  backendBaseUrl,
                  logger,
                );
                return filtered;
              },
            };
          },
        });

        const preloadRouter = Router();
        mountPreloadEndpoint(preloadRouter, store, {
          featuresBootstrapEnabled,
          logger,
        });
        rootHttpRouter.use(DYNAMIC_FEATURES_PRELOAD_BASE_PATH, preloadRouter);

        logger.info(
          `dynamic-features-resolver: preload endpoint at ${DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH}` +
            ` (features bootstrap ${featuresBootstrapEnabled ? 'enabled' : 'disabled'} → ${DYNAMIC_FEATURES_BOOTSTRAP_SCRIPT_PATH})`,
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
