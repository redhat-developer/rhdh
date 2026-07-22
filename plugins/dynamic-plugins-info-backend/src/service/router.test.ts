import { DynamicPluginProvider } from '@backstage/backend-dynamic-feature-service';
import { mockServices } from '@backstage/backend-test-utils';

import express from 'express';
import request from 'supertest';

import { plugins } from '../../__fixtures__/data';
import { expectedList } from '../../__fixtures__/expected_result';
import { createRouter } from './router';

const buildApp = async (
  pluginList: unknown[],
  httpAuth = mockServices.httpAuth(),
) => {
  // The router only consumes `pluginProvider.plugins()`, so a stub against
  // that public method is enough and avoids coupling to the manager internals.
  const pluginProvider = {
    plugins: () => pluginList,
  } as unknown as DynamicPluginProvider;

  const router = await createRouter({
    pluginProvider,
    discovery: mockServices.discovery(),
    httpAuth,
    config: mockServices.rootConfig(),
    logger: mockServices.logger.mock(),
  });

  return express().use(router);
};

describe('createRouter', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('GET /loaded-plugins', () => {
    it('returns the list of loaded dynamic plugins', async () => {
      const app = await buildApp(plugins);

      const response = await request(app).get('/loaded-plugins');

      expect(response.status).toEqual(200);
      expect(response.body).toEqual(expectedList);
    });

    it('strips the installer details from node platform plugins', async () => {
      const app = await buildApp(plugins);

      const response = await request(app).get('/loaded-plugins');

      expect(response.body.length).toBeGreaterThan(0);
      for (const plugin of response.body) {
        expect(plugin).not.toHaveProperty('installer');
      }
    });

    it('returns an empty list when no dynamic plugins are loaded', async () => {
      const app = await buildApp([]);

      const response = await request(app).get('/loaded-plugins');

      expect(response.status).toEqual(200);
      expect(response.body).toEqual([]);
    });

    it('returns front-end plugins unchanged (no installer stripping)', async () => {
      const frontendPlugin = {
        name: 'backstage-plugin-example',
        version: '1.0.0',
        platform: 'web',
        role: 'frontend-plugin',
      };

      const app = await buildApp([frontendPlugin]);

      const response = await request(app).get('/loaded-plugins');

      expect(response.status).toEqual(200);
      expect(response.body).toEqual([frontendPlugin]);
    });

    it('enforces authentication before returning the plugin list', async () => {
      const httpAuth = mockServices.httpAuth();
      const credentialsSpy = jest.spyOn(httpAuth, 'credentials');

      const app = await buildApp(plugins, httpAuth);
      await request(app).get('/loaded-plugins');

      expect(credentialsSpy).toHaveBeenCalledWith(expect.anything(), {
        allow: ['user', 'service'],
      });
    });
  });
});
