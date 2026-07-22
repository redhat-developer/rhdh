import { mockCredentials, mockServices } from '@backstage/backend-test-utils';
import { NotAllowedError } from '@backstage/errors';
import { AuthorizeResult } from '@backstage/plugin-permission-common';

import express from 'express';
import { json2csv } from 'json-2-csv';
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

// Keep the real CSV serializer by default; individual tests override it to
// exercise the conversion-failure branch.
jest.mock('json-2-csv', () => {
  const actual = jest.requireActual('json-2-csv');
  return { ...actual, json2csv: jest.fn(actual.json2csv) };
});

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

    it('returns users without profile data when no catalog entity matches', async () => {
      mockGetListUsers.mockResolvedValue([userRow]);
      mockGetUserEntities.mockResolvedValue(new Map());

      const response = await request(app).get('/users');

      expect(response.status).toEqual(200);
      expect(response.body[0]).toEqual({
        userEntityRef: 'user:default/jdoe',
        lastAuthTime: expect.any(String),
      });
    });

    it('returns 500 when CSV conversion fails', async () => {
      mockGetListUsers.mockResolvedValue([userRow]);
      (json2csv as jest.Mock).mockImplementationOnce(() => {
        throw new Error('conversion failed');
      });

      const response = await request(app)
        .get('/users')
        .set('content-type', 'text/csv');

      expect(response.status).toEqual(500);
      expect(response.text).toContain('Error converting to CSV');
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

  describe('SQLite in-memory database', () => {
    it('disables the router and warns when SQLite has no on-disk directory', async () => {
      const logger = mockServices.logger.mock();
      const router = await createRouter({
        logger,
        config: mockServices.rootConfig({
          data: { backend: { database: { client: 'better-sqlite3' } } },
        }),
        auth: mockServices.auth.mock(),
        discovery: mockServices.discovery.mock(),
        permissions,
        httpAuth: mockServices.httpAuth.mock(),
        lifecycle: mockServices.lifecycle.mock(),
      });
      const disabledApp = express().use(router);

      const response = await request(disabledApp).get('/health');

      expect(response.status).toEqual(404);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('was disabled'),
      );
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

  const permissionsReturning = (
    result: AuthorizeResult.ALLOW | AuthorizeResult.DENY,
  ) => {
    const permissions = mockServices.permissions.mock();
    permissions.authorize.mockResolvedValue([{ result }]);
    return permissions;
  };

  it('resolves when the decision is ALLOW', async () => {
    await expect(
      permissionCheck(permissionsReturning(AuthorizeResult.ALLOW), credentials),
    ).resolves.toBeUndefined();
  });

  it('throws NotAllowedError when the decision is DENY', async () => {
    await expect(
      permissionCheck(permissionsReturning(AuthorizeResult.DENY), credentials),
    ).rejects.toThrow(NotAllowedError);
  });
});
