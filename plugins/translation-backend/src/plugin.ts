import {
  coreServices,
  createBackendPlugin,
} from "@backstage/backend-plugin-api";

import { createRouter } from "./service/router";

export const translationPlugin = createBackendPlugin({
  pluginId: "translation",
  register(env) {
    env.registerInit({
      deps: {
        http: coreServices.httpRouter,
      },
      async init({ http }) {
        http.use(await createRouter());
        http.addAuthPolicy({
          path: "/",
          allow: "unauthenticated",
        });
      },
    });
  },
});
