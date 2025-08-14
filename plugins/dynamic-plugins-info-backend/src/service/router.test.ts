import { DynamicPluginManager } from '@backstage/backend-dynamic-feature-service';
import { mockServices } from '@backstage/backend-test-utils';

import express from 'express';
import request from 'supertest';

import { plugins } from '../../__fixtures__/data';
import { expectedList } from '../../__fixtures__/expected_result';
import { createRouter } from './router';

describe('createRouter', () => {
  let app: express.Express;

  beforeAll(async () => {
    const pluginManager = new (DynamicPluginManager as any)();
    pluginManager._plugins = plugins;

    const router = await createRouter({
      pluginProvider: pluginManager,
      discovery: mockServices.discovery(),
      httpAuth: mockServices.httpAuth(),
      config: mockServices.rootConfig(),
      logger: mockServices.logger.mock(),
    });

    app = express();
    app = express().use(router);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('GET /loaded-plugins', () => {
    it('returns the list of loaded dynamic plugins', async () => {
      const response = await request(app).get('/loaded-plugins');
      expect(response.status).toEqual(200);
      expect(response.body).toEqual(expectedList);
    });
  });
});
