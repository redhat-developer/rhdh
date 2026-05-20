import {
  DynamicPluginProvider,
  dynamicPluginsServiceRef,
} from '@backstage/backend-dynamic-feature-service';
import { createServiceFactory } from '@backstage/backend-plugin-api';
import {
  createMockDirectory,
  mockServices,
  startTestBackend,
} from '@backstage/backend-test-utils';

import request from 'supertest';

import url from 'url';

import { scalprumPlugin } from '../plugin';

// The plugin resolves dynamic frontend packages from `dynamicPluginsServiceRef`.
// A stub lets each test drive the real plugin wiring (router, static serving,
// unauthenticated auth policy) without a dynamic-plugin runtime.
const dynamicPluginsServiceWith = (
  plugins: unknown[],
  availablePackages: unknown[],
) =>
  createServiceFactory({
    service: dynamicPluginsServiceRef,
    deps: {},
    async factory() {
      return {
        plugins: () => plugins,
        availablePackages,
      } as unknown as DynamicPluginProvider;
    },
  });

describe('scalprum backend (Layer 2 integration)', () => {
  it('serves an empty plugin map unauthenticated when no frontend plugins are loaded', async () => {
    const { server } = await startTestBackend({
      features: [
        scalprumPlugin,
        dynamicPluginsServiceWith([], []),
        mockServices.rootConfig.factory(),
      ],
    });

    const response = await request(server).get('/api/scalprum/plugins');

    expect(response.status).toEqual(200);
    expect(response.body).toEqual({});
  }, 30_000);

  it('lists a web plugin and serves its manifest as static content', async () => {
    const mockDir = createMockDirectory();
    mockDir.setContent({
      'dist-scalprum': {
        'plugin-manifest.json': JSON.stringify({ name: 'scalprum-plugin' }),
      },
    });

    const { server } = await startTestBackend({
      features: [
        scalprumPlugin,
        dynamicPluginsServiceWith(
          [{ name: 'frontend-plugin', version: '1.0.0', platform: 'web' }],
          [
            {
              manifest: { name: 'frontend-plugin', version: '1.0.0' },
              location: url.pathToFileURL(mockDir.path),
            },
          ],
        ),
        mockServices.rootConfig.factory(),
      ],
    });

    const list = await request(server).get('/api/scalprum/plugins');
    expect(list.status).toEqual(200);
    expect(list.body['scalprum-plugin']).toMatchObject({
      name: 'scalprum-plugin',
      manifestLocation: expect.stringContaining(
        '/scalprum-plugin/plugin-manifest.json',
      ),
    });

    const manifest = await request(server).get(
      '/api/scalprum/scalprum-plugin/plugin-manifest.json',
    );
    expect(manifest.status).toEqual(200);
    expect(manifest.body).toEqual({ name: 'scalprum-plugin' });
  }, 30_000);
});
