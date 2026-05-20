import {
  DynamicPluginProvider,
  dynamicPluginsServiceRef,
} from '@backstage/backend-dynamic-feature-service';
import { createServiceFactory } from '@backstage/backend-plugin-api';
import { mockServices, startTestBackend } from '@backstage/backend-test-utils';

import request from 'supertest';

import { scalprumPlugin } from '../plugin';

// The plugin resolves dynamic frontend packages from `dynamicPluginsServiceRef`.
// An empty stub exercises the real plugin wiring (router + unauthenticated auth
// policy) without a dynamic-plugin runtime.
const mockDynamicPluginsService = createServiceFactory({
  service: dynamicPluginsServiceRef,
  deps: {},
  async factory() {
    return {
      plugins: () => [],
      availablePackages: [],
    } as unknown as DynamicPluginProvider;
  },
});

describe('scalprum backend (Layer 2 integration)', () => {
  it('starts the real plugin and serves the plugins endpoint unauthenticated', async () => {
    const { server } = await startTestBackend({
      features: [
        scalprumPlugin,
        mockDynamicPluginsService,
        mockServices.rootConfig.factory(),
      ],
    });

    const response = await request(server).get('/api/scalprum/plugins');

    expect(response.status).toEqual(200);
    expect(response.body).toEqual({});
  }, 30_000);
});
