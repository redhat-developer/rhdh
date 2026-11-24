import {
  actionsRegistryServiceFactory,
  actionsServiceFactory,
  metricsServiceFactory,
} from '@backstage/backend-defaults/alpha';
import { auditorServiceFactory } from '@backstage/backend-defaults/auditor';
import { authServiceFactory } from '@backstage/backend-defaults/auth';
import { cacheServiceFactory } from '@backstage/backend-defaults/cache';
import { databaseServiceFactory } from '@backstage/backend-defaults/database';
import { discoveryServiceFactory } from '@backstage/backend-defaults/discovery';
import { httpAuthServiceFactory } from '@backstage/backend-defaults/httpAuth';
import { httpRouterServiceFactory } from '@backstage/backend-defaults/httpRouter';
import { lifecycleServiceFactory } from '@backstage/backend-defaults/lifecycle';
import { loggerServiceFactory } from '@backstage/backend-defaults/logger';
import { permissionsServiceFactory } from '@backstage/backend-defaults/permissions';
import { permissionsRegistryServiceFactory } from '@backstage/backend-defaults/permissionsRegistry';
import { rootConfigServiceFactory } from '@backstage/backend-defaults/rootConfig';
import { rootHealthServiceFactory } from '@backstage/backend-defaults/rootHealth';
import { rootHttpRouterServiceFactory } from '@backstage/backend-defaults/rootHttpRouter';
import { rootLifecycleServiceFactory } from '@backstage/backend-defaults/rootLifecycle';
import {
  rootLoggerServiceFactory,
  WinstonLogger,
} from '@backstage/backend-defaults/rootLogger';
import { rootSystemMetadataServiceFactory } from '@backstage/backend-defaults/rootSystemMetadata';
import { schedulerServiceFactory } from '@backstage/backend-defaults/scheduler';
import { urlReaderServiceFactory } from '@backstage/backend-defaults/urlReader';
import { userInfoServiceFactory } from '@backstage/backend-defaults/userInfo';
import type { ServiceFactory } from '@backstage/backend-plugin-api';
import { targetPaths } from '@backstage/cli-common';
import { eventsServiceFactory } from '@backstage/plugin-events-node';

import { appHtmlFetchPriorityMiddleware } from './middleware/appHtmlFetchPriority';
import { createCompressionDictionaryMiddleware } from './middleware/compressionDictionary';
import { dynamicRemotesStaticCacheMiddleware } from './middleware/dynamicRemotesStaticCache';
import { hashedRemoteEntriesMiddleware } from './middleware/hashedRemoteEntries';

/**
 * Service factories that are added to the backend statically by default.  This
 * should be kept up to date with the upstream package code, which is currently
 * not exported.
 *
 * Intentionally omitted vs upstream `@backstage/backend-defaults`:
 * - `core.instanceMetadata` (deprecated upstream service, replaced by `core.rootSystemMetadata`)
 * - `alpha.core.tracing` (RHDH uses custom OpenTelemetry in `instrumentation.js`)
 */
export const DEFAULT_SERVICE_FACTORIES: ServiceFactory[] = [
  auditorServiceFactory,
  authServiceFactory,
  cacheServiceFactory,
  rootConfigServiceFactory,
  databaseServiceFactory,
  discoveryServiceFactory,
  httpAuthServiceFactory,
  httpRouterServiceFactory,
  lifecycleServiceFactory,
  loggerServiceFactory,
  permissionsServiceFactory,
  permissionsRegistryServiceFactory,
  rootHealthServiceFactory,
  // Custom configure so hashed remotes `/static/` get long-lived Cache-Control,
  // the served app HTML gets fetchpriority hints on its defer scripts,
  // content-hashed remote entries are served immutable from the in-memory
  // registry, and (opt-in) remote assets get Compression Dictionary Transport.
  // Re-include dynamicRemotesStaticCacheMiddleware,
  // appHtmlFetchPriorityMiddleware, hashedRemoteEntriesMiddleware and the
  // compression dictionary middleware if replacing core.rootHttpRouter.
  rootHttpRouterServiceFactory({
    configure({ app, applyDefaults, config }) {
      app.use(dynamicRemotesStaticCacheMiddleware);
      app.use(appHtmlFetchPriorityMiddleware);
      // Before hashedRemoteEntriesMiddleware so dictionary-compressed
      // responses win and the hashed-entries immutable Brotli serves the
      // requests that fall through without a dictionary offer.
      if (
        config.getOptionalBoolean(
          'dynamicPlugins.frontend.compressionDictionary.enabled',
        )
      ) {
        const pluginsRootDirectory = config.getOptionalString(
          'dynamicPlugins.rootDirectory',
        );
        if (pluginsRootDirectory) {
          app.use(
            createCompressionDictionaryMiddleware({
              pluginsRootDirectory:
                targetPaths.resolveRoot(pluginsRootDirectory),
            }),
          );
        }
      }
      app.use(hashedRemoteEntriesMiddleware());
      applyDefaults();
    },
  }),
  rootLifecycleServiceFactory,
  rootLoggerServiceFactory,
  rootSystemMetadataServiceFactory,
  schedulerServiceFactory,
  userInfoServiceFactory,
  urlReaderServiceFactory,
  eventsServiceFactory,
  // alpha services
  actionsRegistryServiceFactory,
  actionsServiceFactory,
  metricsServiceFactory,
] as const;

/**
 * Whether the given core service factory is being replaced by a dynamic
 * plugin, via its `ENABLE_<SERVICE_ID>_OVERRIDE` environment variable.
 *
 * This is the single source of truth for the env-name derivation; other
 * modules (e.g. the dynamic-features resolver) must use it to stay
 * consistent with the filtering below.
 */
export function isCoreServiceOverrideEnabled(serviceId: string): boolean {
  const envName = `ENABLE_${serviceId
    .toLocaleUpperCase()
    .replace('.', '_')}_OVERRIDE`;
  return (process.env[envName] ?? '').toLocaleLowerCase() === 'true';
}

export const getDefaultServiceFactories = ({
  logger,
}: {
  logger: WinstonLogger;
}) => {
  return DEFAULT_SERVICE_FACTORIES.filter(serviceFactory => {
    if (!isCoreServiceOverrideEnabled(serviceFactory.service.id)) {
      logger.debug(
        `Adding service factory "${serviceFactory.service.id}", to override set "ENABLE_${serviceFactory.service.id
          .toLocaleUpperCase()
          .replace('.', '_')}_OVERRIDE" to "true"`,
      );
      return true;
    }
    logger.warn(
      `Allowing override for service factory "${serviceFactory.service.id}"`,
    );
    return false;
  });
};
