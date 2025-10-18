import { MiddlewareFactory } from '@backstage/backend-defaults/rootHttpRouter';
import {
  BaseDynamicPlugin,
  DynamicPluginProvider,
} from '@backstage/backend-dynamic-feature-service';
import {
  DiscoveryService,
  HttpAuthService,
  LoggerService,
} from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';

import express, { Router } from 'express';

export interface RouterOptions {
  pluginProvider: DynamicPluginProvider;
  discovery: DiscoveryService;
  httpAuth: HttpAuthService;
  logger: LoggerService;
  config: Config;
}

export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { logger, pluginProvider, config, httpAuth } = options;

  const router = Router();
  router.use(express.json());

  const plugins = pluginProvider.plugins();
  const dynamicPlugins = plugins.map(p => {
    // Remove the installer details for the dynamic backend plugins
    if (p.platform === 'node') {
      const { installer, ...rest } = p;
      return rest as BaseDynamicPlugin;
    }
    return p as BaseDynamicPlugin;
  });
  router.get('/loaded-plugins', async (req, response) => {
    await httpAuth.credentials(req, { allow: ['user', 'service'] });
    response.send(dynamicPlugins);
  });
  const middleware = MiddlewareFactory.create({ logger, config });

  router.use(middleware.error());
  return router;
}
