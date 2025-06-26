import { createBackend } from '@backstage/backend-defaults';
import { WinstonLogger } from '@backstage/backend-defaults/rootLogger';
import {
  CommonJSModuleLoader,
  dynamicPluginsFeatureLoader,
  dynamicPluginsFrontendServiceRef,
} from '@backstage/backend-dynamic-feature-service';
import { createServiceFactory } from '@backstage/backend-plugin-api';
import { PackageRoles } from '@backstage/cli-node';

import * as path from 'path';

import { configureCorporateProxyAgent } from './corporate-proxy';
import { getDefaultServiceFactories } from './defaultServiceFactories';
import {
  healthCheckPlugin,
  pluginIDProviderService,
  rbacDynamicPluginsProvider,
} from './modules';

// Create a logger to cover logging static initialization tasks
const staticLogger = WinstonLogger.create({
  meta: { service: 'developer-hub-init' },
});
staticLogger.info('Starting Developer Hub backend');

// RHIDP-2217: adds support for corporate proxy
configureCorporateProxyAgent();

const backend = createBackend();

const defaultServiceFactories = getDefaultServiceFactories({
  logger: staticLogger,
});
defaultServiceFactories.forEach(serviceFactory => {
  backend.add(serviceFactory);
});

backend.add(
  dynamicPluginsFeatureLoader({
    schemaLocator(pluginPackage) {
      const platform = PackageRoles.getRoleInfo(
        pluginPackage.manifest.backstage.role,
      ).platform;
      return path.join(
        platform === 'node' ? 'dist' : 'dist-scalprum',
        'configSchema.json',
      );
    },

    moduleLoader: logger =>
      new CommonJSModuleLoader({
        logger,
        // Customize dynamic plugin packager resolution to support the case
        // of dynamic plugin wrapper packages.
        customResolveDynamicPackage(
          _,
          searchedPackageName,
          scannedPluginManifests,
        ) {
          for (const [realPath, pkg] of scannedPluginManifests.entries()) {
            // A dynamic plugin wrapper package has a direct dependency to the wrapped package
            if (
              Object.keys(pkg.dependencies ?? {}).includes(searchedPackageName)
            ) {
              const searchPath = path.resolve(realPath, 'node_modules');
              try {
                const resolvedPath = require.resolve(
                  `${searchedPackageName}/package.json`,
                  {
                    paths: [searchPath],
                  },
                );
                logger.info(
                  `Resolved '${searchedPackageName}' at ${resolvedPath}`,
                );
                return resolvedPath;
              } catch (e) {
                this.logger.error(
                  `Error when resolving '${searchedPackageName}' with search path: '[${searchPath}]'`,
                  e instanceof Error ? e : undefined,
                );
              }
            }
          }
          return undefined;
        },
      }),
  }),
);

if (
  (process.env.ENABLE_STANDARD_MODULE_FEDERATION || '').toLocaleLowerCase() !==
  'true'
) {
  // When the `dynamicPlugins` entry exists in the configuration, the upstream dynamic plugins backend feature loader
  // also loads the `dynamicPluginsFrontendServiceRef` service that installs an http router to serve
  // standard Module Federation assets for every installed dynamic frontend plugin.
  // For now in RHDH the old frontend application doesn't use standard module federation and, by default,
  // exported RHDH dynamic frontend plugins don't contain standard module federation assets.
  // That's why we disable (bu overriding it with a noop) this service unless stadard module federation use
  // is explicitly requested.
  backend.add(
    createServiceFactory({
      service: dynamicPluginsFrontendServiceRef,
      deps: {},
      factory: () => ({
        setResolverProvider() {},
      }),
    }),
  );
}

backend.add(healthCheckPlugin);

backend.add(import('@backstage/plugin-app-backend'));
backend.add(
  import('@backstage/plugin-catalog-backend-module-scaffolder-entity-model'),
);

// See https://backstage.io/docs/features/software-catalog/configuration#subscribing-to-catalog-errors
backend.add(import('@backstage/plugin-catalog-backend-module-logs'));

backend.add(import('@backstage/plugin-catalog-backend'));

// TODO: Probably we should now provide this as a dynamic plugin
backend.add(import('@backstage/plugin-catalog-backend-module-openapi'));

backend.add(import('@backstage/plugin-proxy-backend'));

// TODO: Check in the Scaffolder new backend plugin why the identity is not passed and the default is built instead.
backend.add(import('@backstage/plugin-scaffolder-backend'));

// search engine
// See https://backstage.io/docs/features/search/search-engines
backend.add(import('@backstage/plugin-search-backend-module-pg'));

// search collators
backend.add(import('@backstage/plugin-search-backend'));
backend.add(import('@backstage/plugin-search-backend-module-catalog'));

// TODO: We should test it more deeply. The structure is not exactly the same as the old backend implementation
backend.add(import('@backstage/plugin-events-backend'));

backend.add(import('@backstage-community/plugin-rbac-backend'));
backend.add(
  import('@backstage-community/plugin-scaffolder-backend-module-annotator'),
);
backend.add(pluginIDProviderService);
backend.add(rbacDynamicPluginsProvider);

backend.add(import('@backstage/plugin-auth-backend'));
backend.add(import('@backstage/plugin-auth-backend-module-guest-provider'));
if (process.env.ENABLE_AUTH_PROVIDER_MODULE_OVERRIDE !== 'true') {
  backend.add(import('./modules/authProvidersModule'));
} else {
  staticLogger.info(`Default authentication provider module disabled`);
}

backend.add(import('@internal/plugin-dynamic-plugins-info-backend'));
backend.add(import('@internal/plugin-scalprum-backend'));
backend.add(import('@internal/plugin-licensed-users-info-backend'));

backend.start();
