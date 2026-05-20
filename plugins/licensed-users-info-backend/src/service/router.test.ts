import { mockCredentials, mockServices } from '@backstage/backend-test-utils';
import { NotAllowedError } from '@backstage/errors';
import { AuthorizeResult } from '@backstage/plugin-permission-common';

import express from 'express';
import request from 'supertest';

import { createRouter, permissionCheck, rowToResponse } from './router';

jest.mock('@backstage/backend-defaults/database', () => ({
  DatabaseManager: {
    fromConfig: jest.fn().mockReturnValue({
      forPlugin: jest.fn().mockReturnValue({
        getClient: jest.fn().mockResolvedValue({}),
      }),
    }),
  },
}));

const mockGetQuantityRecordedActiveUsers = jest.fn();
const mockGetListUsers = jest.fn();
jest.mock('../database/databaseUserInfoStore', () => ({
  DatabaseUserInfoStore: jest.fn().mockImplementation(() => ({
    getQuantityRecordedActiveUsers: mockGetQuantityRecordedActiveUsers,
    getListUsers: mockGetListUsers,
  })),
}));

const mockGetUserEntities = jest.fn();
jest.mock('./catalogStore', () => ({
  CatalogEntityStore: jest.fn().mockImplementation(() => ({
    getUserEntities: mockGetUserEntities,
  })),
}));

describe('createRouter', () => {
  let app: express.Express;
  const permissions = mockServices.permissions.mock();

  const buildApp = async () => {
    const router = await createRouter({
      logger: mockServices.logger.mock(),
      config: mockServices.rootConfig(),
      auth: mockServices.auth.mock(),
      discovery: mockServices.discovery.mock(),
      permissions,
      httpAuth: mockServices.httpAuth.mock(),
      lifecycle: mockServices.lifecycle.mock(),
    });
    return express().use(router);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    permissions.authorize.mockResolvedValue([
      { result: AuthorizeResult.ALLOW },
    ]);
    mockGetUserEntities.mockResolvedValue(new Map());
    app = await buildApp();
  });

  describe('GET /health', () => {
    it('returns ok without requiring authorization', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toEqual(200);
      expect(response.body).toEqual({ status: 'ok' });
      expect(permissions.authorize).not.toHaveBeenCalled();
    });
  });

  describe('GET /users/quantity', () => {
    it('returns the number of recorded active users', async () => {
      mockGetQuantityRecordedActiveUsers.mockResolvedValue(42);

      const response = await request(app).get('/users/quantity');

      expect(response.status).toEqual(200);
      expect(response.body).toEqual({ quantity: 42 });
    });

    it('returns 403 when the caller is not authorized', async () => {
      permissions.authorize.mockResolvedValue([
        { result: AuthorizeResult.DENY },
      ]);

      const response = await request(app).get('/users/quantity');

      expect(response.status).toEqual(403);
      expect(mockGetQuantityRecordedActiveUsers).not.toHaveBeenCalled();
    });
  });

  describe('GET /users', () => {
    const userRow = {
      user_entity_ref: 'user:default/jdoe',
      user_info: '{}',
      updated_at: '2026-01-01 12:00:00',
    };

    it('returns the list of users enriched with catalog profile data', async () => {
      mockGetListUsers.mockResolvedValue([userRow]);
      mockGetUserEntities.mockResolvedValue(
        new Map([
          [
            'user:default/jdoe',
            {
              spec: {
                profile: {
                  displayName: 'John Doe',
                  email: 'jdoe@example.com',
                },
              },
            },
          ],
        ]),
      );

      const response = await request(app).get('/users');

      expect(response.status).toEqual(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toMatchObject({
        userEntityRef: 'user:default/jdoe',
        displayName: 'John Doe',
        email: 'jdoe@example.com',
      });
    });

    it('returns the list as CSV when the content-type is text/csv', async () => {
      mockGetListUsers.mockResolvedValue([userRow]);

      const response = await request(app)
        .get('/users')
        .set('content-type', 'text/csv');

      expect(response.status).toEqual(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.text).toContain('userEntityRef');
      expect(response.text).toContain('user:default/jdoe');
    });

    it('returns 403 when the caller is not authorized', async () => {
      permissions.authorize.mockResolvedValue([
        { result: AuthorizeResult.DENY },
      ]);

      const response = await request(app).get('/users');

      expect(response.status).toEqual(403);
      expect(mockGetListUsers).not.toHaveBeenCalled();
    });
  });
});

describe('rowToResponse', () => {
  it('parses a SQL timestamp and back-dates it by the token expiration window', () => {
    const result = rowToResponse(
      {
        user_entity_ref: 'user:default/jdoe',
        user_info: '{}',
        updated_at: '2026-01-01 12:00:00',
      },
      3600,
    );

    expect(result.userEntityRef).toEqual('user:default/jdoe');
    // 12:00:00 UTC minus a 3600s window => 11:00:00 UTC
    expect(result.lastAuthTime).toEqual('Thu, 01 Jan 2026 11:00:00 GMT');
  });

  it('falls back to JS Date parsing for ISO timestamps', () => {
    const result = rowToResponse(
      {
        user_entity_ref: 'user:default/jdoe',
        user_info: '{}',
        updated_at: '2026-01-01T12:00:00.000Z',
      },
      3600,
    );

    expect(result.lastAuthTime).toEqual('Thu, 01 Jan 2026 11:00:00 GMT');
  });

  it('throws when the timestamp cannot be parsed', () => {
    expect(() =>
      rowToResponse(
        {
          user_entity_ref: 'user:default/jdoe',
          user_info: '{}',
          updated_at: 'not-a-date',
        },
        3600,
      ),
    ).toThrow('Failed to parse expiration date format');
  });
});

describe('permissionCheck', () => {
  const credentials = mockCredentials.user();

  it('resolves when the decision is ALLOW', async () => {
    const permissions = mockServices.permissions.mock();
    permissions.authorize.mockResolvedValue([
      { result: AuthorizeResult.ALLOW },
    ]);

    await expect(
      permissionCheck(permissions, credentials),
    ).resolves.toBeUndefined();
  });

  it('throws NotAllowedError when the decision is DENY', async () => {
    const permissions = mockServices.permissions.mock();
    permissions.authorize.mockResolvedValue([{ result: AuthorizeResult.DENY }]);

    await expect(permissionCheck(permissions, credentials)).rejects.toThrow(
      NotAllowedError,
    );
  });
});
