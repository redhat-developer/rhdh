import {
  DynamicPluginManager,
  dynamicPluginsServiceRef,
} from '@backstage/backend-dynamic-feature-service';
import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';

import { createRouter } from './service/router';

export const scalprumPlugin = createBackendPlugin({
  pluginId: 'scalprum',
  register(env) {
    env.registerInit({
      deps: {
        http: coreServices.httpRouter,
        discovery: coreServices.discovery,
        logger: coreServices.logger,
        pluginProvider: dynamicPluginsServiceRef,
        config: coreServices.rootConfig,
      },
      async init({ http, discovery, logger, pluginProvider, config }) {
        http.use(
          await createRouter({
            logger,
            pluginManager: pluginProvider as DynamicPluginManager,
            discovery,
            config,
          }),
        );
        http.addAuthPolicy({
          path: '/',
          allow: 'unauthenticated',
        });
      },
    });
  },
});
