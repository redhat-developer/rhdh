import { mockServices } from '@backstage/backend-test-utils';

import express from 'express';
import request from 'supertest';

import { createRouter } from './router';

jest.mock('@backstage/backend-defaults/database', () => ({
  DatabaseManager: {
    fromConfig: jest.fn().mockReturnValue({
      forPlugin: jest.fn().mockReturnValue({
        getClient: jest.fn().mockResolvedValue({}),
      }),
    }),
  },
}));

describe('createRouter', () => {
  let app: express.Express;

  beforeAll(async () => {
    // TODO: Replace with module
    const router = await createRouter({
      logger: mockServices.logger.mock(),
      config: mockServices.rootConfig(),
      auth: mockServices.auth.mock(),
      discovery: mockServices.discovery.mock(),
      permissions: mockServices.permissions.mock(),
      httpAuth: mockServices.httpAuth.mock(),
      lifecycle: mockServices.lifecycle.mock(),
    });
    app = express().use(router);
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('GET /health', () => {
    it('returns ok', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toEqual(200);
      expect(response.body).toEqual({ status: 'ok' });
    });
  });
});
