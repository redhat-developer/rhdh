import {
  actionsRegistryServiceFactory,
  actionsServiceFactory,
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
import { schedulerServiceFactory } from '@backstage/backend-defaults/scheduler';
import { urlReaderServiceFactory } from '@backstage/backend-defaults/urlReader';
import { userInfoServiceFactory } from '@backstage/backend-defaults/userInfo';
import type { ServiceFactory } from '@backstage/backend-plugin-api';
import { eventsServiceFactory } from '@backstage/plugin-events-node';

/**
 * Service factories that are added to the backend statically by default.  This
 * should be kept up to date with the upstream package code, which is currently
 * not exported.
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
  rootHttpRouterServiceFactory,
  rootLifecycleServiceFactory,
  rootLoggerServiceFactory,
  schedulerServiceFactory,
  userInfoServiceFactory,
  urlReaderServiceFactory,
  eventsServiceFactory,
  // alpha services
  actionsRegistryServiceFactory,
  actionsServiceFactory,
] as const;

export const getDefaultServiceFactories = ({
  logger,
}: {
  logger: WinstonLogger;
}) => {
  return DEFAULT_SERVICE_FACTORIES.filter(serviceFactory => {
    const envName = `ENABLE_${serviceFactory.service.id.toLocaleUpperCase().replace('.', '_')}_OVERRIDE`;
    if ((process.env[envName] || '').toLocaleLowerCase() !== 'true') {
      logger.debug(
        `Adding service factory "${serviceFactory.service.id}", to override set "${envName}" to "true"`,
      );
      return true;
    }
    logger.warn(
      `Allowing override for service factory "${serviceFactory.service.id}"`,
    );
    return false;
  });
};
