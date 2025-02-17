import {
  createApiFactory,
  createComponentExtension,
  createPlugin,
  createRoutableExtension,
  discoveryApiRef,
  fetchApiRef,
  identityApiRef,
} from '@backstage/core-plugin-api';

import { DynamicPluginsInfoClient } from './api/DynamicPluginsInfoClient';
import { dynamicPluginsInfoApiRef } from './api/types';
import { dynamicPluginsInfoRouteRef } from './routes';

export const dynamicPluginsInfoPlugin = createPlugin({
  id: 'dynamic-plugins-info',
  routes: {
    root: dynamicPluginsInfoRouteRef,
  },
  apis: [
    createApiFactory({
      api: dynamicPluginsInfoApiRef,
      deps: {
        discoveryApi: discoveryApiRef,
        fetchApi: fetchApiRef,
        identityApi: identityApiRef,
      },
      factory: ({ discoveryApi, fetchApi, identityApi }) =>
        new DynamicPluginsInfoClient({ discoveryApi, fetchApi, identityApi }),
    }),
  ],
});

export const DynamicPluginsInfoPage = dynamicPluginsInfoPlugin.provide(
  createRoutableExtension({
    name: 'DynamicPluginsInfoPage',
    component: () =>
      import('./components/DynamicPluginsInfoPage').then(
        m => m.DynamicPluginsInfoPage,
      ),
    mountPoint: dynamicPluginsInfoRouteRef,
  }),
);

export const DynamicPluginsInfoContent = dynamicPluginsInfoPlugin.provide(
  createComponentExtension({
    name: 'DynamicPluginsInfoContent',
    component: {
      lazy: () =>
        import(
          './components/DynamicPluginsInfoContent/DynamicPluginsInfoContent'
        ).then(m => m.DynamicPluginsInfoContent),
    },
  }),
);
