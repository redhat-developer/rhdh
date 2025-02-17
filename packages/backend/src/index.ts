import { createBackend } from '@backstage/backend-defaults';
import { dynamicPluginsFeatureLoader } from '@backstage/backend-dynamic-feature-service';
import { PackageRoles } from '@backstage/cli-node';

import * as path from 'path';

import { configureCorporateProxyAgent } from './corporate-proxy';
import { getDefaultServiceFactories } from './defaultServiceFactories';
import { CommonJSModuleLoader } from './loader';
import { createStaticLogger, transports } from './logger';
import {
  healthCheckPlugin,
  pluginIDProviderService,
  rbacDynamicPluginsProvider,
} from './modules';

// Create a logger to cover logging static initialization tasks
const staticLogger = createStaticLogger({ service: 'developer-hub-init' });
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
    moduleLoader: logger => new CommonJSModuleLoader(logger),
    logger: config => {
      const auditLogConfig = config?.getOptionalConfig('auditLog');
      return {
        transports: [...transports.log, ...transports.auditLog(auditLogConfig)],
      };
    },
  }),
);

backend.add(healthCheckPlugin);

backend.add(import('@backstage/plugin-app-backend/alpha'));
backend.add(
  import('@backstage/plugin-catalog-backend-module-scaffolder-entity-model'),
);

// See https://backstage.io/docs/features/software-catalog/configuration#subscribing-to-catalog-errors
backend.add(import('@backstage/plugin-catalog-backend-module-logs'));

backend.add(import('@backstage/plugin-catalog-backend/alpha'));

// TODO: Probably we should now provide this as a dynamic plugin
backend.add(import('@backstage/plugin-catalog-backend-module-openapi'));

backend.add(import('@backstage/plugin-proxy-backend'));

// TODO: Check in the Scaffolder new backend plugin why the identity is not passed and the default is built instead.
backend.add(import('@backstage/plugin-scaffolder-backend/alpha'));

// search engine
// See https://backstage.io/docs/features/search/search-engines
backend.add(import('@backstage/plugin-search-backend-module-pg'));

// search collators
backend.add(import('@backstage/plugin-search-backend'));
backend.add(import('@backstage/plugin-search-backend-module-catalog'));

// TODO: We should test it more deeply. The structure is not exactly the same as the old backend implementation
backend.add(import('@backstage/plugin-events-backend'));

backend.add(import('@oandriie/plugin-rbac-backend'));
backend.add(
  import('@backstage-community/plugin-scaffolder-backend-module-annotator'),
);
backend.add(pluginIDProviderService);
backend.add(rbacDynamicPluginsProvider);

backend.add(import('@backstage/plugin-auth-backend'));
backend.add(import('@backstage/plugin-auth-backend-module-guest-provider'));
backend.add(import('./modules/authProvidersModule'));

backend.add(import('@internal/plugin-dynamic-plugins-info-backend'));
backend.add(import('@internal/plugin-scalprum-backend'));
backend.add(import('@internal/plugin-licensed-users-info-backend'));

backend.start();
