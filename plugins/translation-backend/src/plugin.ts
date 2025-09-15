import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';

import { createRouter } from './service/router';

export const translationPlugin = createBackendPlugin({
  pluginId: 'translation',
  register(env) {
    env.registerInit({
      deps: {
        http: coreServices.httpRouter,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ http, config, logger }) {
        http.use(await createRouter({ config, logger }));
        http.addAuthPolicy({
          path: '/',
          allow: 'unauthenticated',
        });
      },
    });
  },
});
