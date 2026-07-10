import {
  dynamicPluginsFrontendServiceRef,
  FrontendRemoteResolverProvider,
} from '@backstage/backend-dynamic-feature-service';
import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';

import * as fs from 'fs';
import * as path from 'path';

const NFS_FEATURE_TYPES = new Set([
  '@backstage/FrontendPlugin',
  '@backstage/FrontendModule',
]);

export const nfsModuleFilterPlugin = createBackendPlugin({
  pluginId: 'nfs-module-filter',
  register(reg) {
    reg.registerInit({
      deps: {
        frontendRemotes: dynamicPluginsFrontendServiceRef,
        logger: coreServices.rootLogger,
      },
      async init({ frontendRemotes, logger }) {
        const provider: FrontendRemoteResolverProvider = {
          for(pluginName, pluginPackagePath) {
            let features: Record<string, string> | undefined;
            try {
              const pkgJsonPath = path.join(pluginPackagePath, 'package.json');
              const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
              features = pkgJson.backstage?.features;
            } catch (error) {
              logger.warn(
                `nfs-module-filter: failed to read package.json for plugin '${pluginName}': ${error}`,
              );
              return undefined;
            }

            if (!features || Object.keys(features).length === 0) {
              return undefined;
            }

            return {
              overrideExposedModules(exposedModules) {
                const kept: string[] = [];
                const removed: string[] = [];

                for (const moduleName of exposedModules) {
                  const mount =
                    moduleName === '.' || moduleName.startsWith('./')
                      ? moduleName
                      : `./${moduleName}`;
                  const featureType = features![mount];

                  if (
                    featureType !== undefined &&
                    NFS_FEATURE_TYPES.has(featureType)
                  ) {
                    kept.push(moduleName);
                  } else {
                    removed.push(moduleName);
                  }
                }

                if (removed.length > 0) {
                  logger.info(
                    `nfs-module-filter: plugin '${pluginName}': kept [${kept.join(', ')}], filtered out [${removed.join(', ')}]`,
                  );
                }

                return kept;
              },
            };
          },
        };

        frontendRemotes.setResolverProvider(provider);
        logger.info(
          'nfs-module-filter: registered frontend remote resolver provider',
        );
      },
    });
  },
});
