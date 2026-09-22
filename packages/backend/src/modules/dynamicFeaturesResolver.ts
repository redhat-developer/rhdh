import { dynamicPluginsFrontendServiceRef } from '@backstage/backend-dynamic-feature-service';
import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';

import { Router } from 'express';

import { collectPluginPreload } from './dynamicFeaturesPreload/collector';
import { mountPreloadEndpoint } from './dynamicFeaturesPreload/handler';
import {
  DYNAMIC_FEATURES_PRELOAD_BASE_PATH,
  DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH,
} from './dynamicFeaturesPreload/paths';
import { createPreloadStore } from './dynamicFeaturesPreload/store';
import {
  filterNfsExposedModules,
  readBackstageFeatures,
} from './nfsModuleFilter';

/**
 * Backend plugin that registers the single FrontendRemoteResolverProvider:
 *
 * 1. Filters exposed modules to NFS entrypoints (FrontendPlugin / FrontendModule)
 * 2. Collects MF snapshot data for each plugin into a shared store
 * 3. Mounts a CSP-safe `preload.js` endpoint that prefills MF globals,
 *    shims the remotes fetch, and injects remoteEntry / sync-asset hints
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

        frontendRemotes.setResolverProvider({
          for(pluginName, pluginPackagePath) {
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
        mountPreloadEndpoint(preloadRouter, store);
        rootHttpRouter.use(DYNAMIC_FEATURES_PRELOAD_BASE_PATH, preloadRouter);

        logger.info(
          `dynamic-features-resolver: preload endpoint at ${DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH}`,
        );
      },
    });
  },
});
