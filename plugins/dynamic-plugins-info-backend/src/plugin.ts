import { dynamicPluginsServiceRef } from '@backstage/backend-dynamic-feature-service';
import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';

import { createRouter } from './service/router';

export const dynamicPluginsInfoPlugin = createBackendPlugin({
  pluginId: 'dynamic-plugins-info',
  register(env) {
    env.registerInit({
      deps: {
        http: coreServices.httpRouter,
        // TODO: Replace type
        pluginProvider: dynamicPluginsServiceRef,
        httpAuth: coreServices.httpAuth,
        discovery: coreServices.discovery,
        logger: coreServices.logger,
        config: coreServices.rootConfig,
      },
      async init({
        http,
        pluginProvider,
        httpAuth,
        discovery,
        logger,
        config,
      }) {
        http.use(
          await createRouter({
            pluginProvider,
            httpAuth,
            discovery,
            logger,
            config,
          }),
        );
      },
    });
  },
});
