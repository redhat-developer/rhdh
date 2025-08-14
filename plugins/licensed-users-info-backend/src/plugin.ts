import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';

import { createRouter } from './service/router';

/**
 * licensedUsersInfoPlugin backend plugin
 *
 * @public
 */
export const licensedUsersInfoPlugin = createBackendPlugin({
  pluginId: 'licensed-users-info',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
        config: coreServices.rootConfig,
        auth: coreServices.auth,
        discovery: coreServices.discovery,
        permissions: coreServices.permissions,
        httpAuth: coreServices.httpAuth,
        lifecycle: coreServices.lifecycle,
      },
      async init({
        httpRouter,
        logger,
        config,
        auth,
        discovery,
        permissions,
        httpAuth,
        lifecycle,
      }) {
        httpRouter.use(
          await createRouter({
            logger,
            config,
            auth,
            discovery,
            permissions,
            httpAuth,
            lifecycle,
          }),
        );
        httpRouter.addAuthPolicy({
          path: '/health',
          allow: 'unauthenticated',
        });
      },
    });
  },
});
