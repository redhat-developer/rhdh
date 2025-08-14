import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';

export const healthCheckPlugin = createBackendPlugin({
  pluginId: 'healthcheck',
  register(reg) {
    reg.registerInit({
      deps: {
        rootHttpRouter: coreServices.rootHttpRouter,
        rootHealth: coreServices.rootHealth,
      },
      async init({ rootHttpRouter, rootHealth }) {
        rootHttpRouter.use('/healthcheck', async (_, res) => {
          const { status, payload } = await rootHealth.getLiveness();
          res.status(status).json(payload);
        });
      },
    });
  },
});
