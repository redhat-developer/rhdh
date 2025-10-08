import { DatabaseManager } from '@backstage/backend-defaults/database';
import { MiddlewareFactory } from '@backstage/backend-defaults/rootHttpRouter';
import type {
  AuthService,
  BackstageCredentials,
  DiscoveryService,
  HttpAuthService,
  LifecycleService,
  LoggerService,
  PermissionsService,
  RootConfigService,
} from '@backstage/backend-plugin-api';
import { CatalogClient } from '@backstage/catalog-client';
import { NotAllowedError } from '@backstage/errors';
import { AuthorizeResult } from '@backstage/plugin-permission-common';

import { policyEntityReadPermission } from '@backstage-community/plugin-rbac-common';
import express from 'express';
import Router from 'express-promise-router';
import { json2csv } from 'json-2-csv';
import { DateTime } from 'luxon';

import {
  DatabaseUserInfoStore,
  UserInfoRow,
} from '../database/databaseUserInfoStore';
import { CatalogEntityStore } from './catalogStore';
import { readBackstageTokenExpiration } from './readBackstageTokenExpiration';

export interface RouterOptions {
  logger: LoggerService;
  config: RootConfigService;
  auth: AuthService;
  discovery: DiscoveryService;
  permissions: PermissionsService;
  httpAuth: HttpAuthService;
  lifecycle: LifecycleService;
}

export type UserInfoResponse = {
  // firstLoginTime: string;
  userEntityRef: string;
  displayName?: string;
  email?: string;
  lastAuthTime: string;
};

export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { logger, config, auth, discovery, permissions, httpAuth, lifecycle } =
    options;

  const tokenExpiration = readBackstageTokenExpiration(config);

  const authDB = await DatabaseManager.fromConfig(options.config)
    .forPlugin('auth', { logger, lifecycle })
    .getClient();

  const catalogClient = new CatalogClient({ discoveryApi: discovery });

  const userInfoStore = new DatabaseUserInfoStore(authDB);
  const catalogEntityStore = new CatalogEntityStore(catalogClient, auth);

  const router = Router();
  router.use(express.json());

  if (await isSqliteInMemory(config)) {
    logger.warn(
      `The plugin-licensed-users-info-backend was disabled because it does not support the SQLite in-memory database configuration.`,
    );
    return router;
  }

  router.get('/health', (_, response) => {
    response.json({ status: 'ok' });
  });

  router.get('/users/quantity', async (request, response) => {
    await permissionCheck(permissions, await httpAuth.credentials(request));

    const quantity = await userInfoStore.getQuantityRecordedActiveUsers();
    response.json({ quantity });
  });

  router.get('/users', async (request, response) => {
    await permissionCheck(permissions, await httpAuth.credentials(request));

    const usersRow = await userInfoStore.getListUsers();
    const users = usersRow.map(userInfoRow =>
      rowToResponse(userInfoRow, tokenExpiration),
    );

    const userEntities = await catalogEntityStore.getUserEntities();
    for (const userInfo of users) {
      const entity = userEntities.get(userInfo.userEntityRef);
      if (entity?.spec?.profile) {
        userInfo.displayName = (entity.spec.profile as any)
          .displayName as string;
        userInfo.email = (entity.spec.profile as any).email as string;
      }
    }

    if (request.headers['content-type']?.includes('text/csv')) {
      try {
        const csv = json2csv(users, {
          keys: ['userEntityRef', 'displayName', 'email', 'lastAuthTime'],
        });
        response.header('Content-Type', 'text/csv');
        response.attachment('data.csv');
        response.send(csv);
      } catch (err) {
        response.status(500).send('Error converting to CSV');
      }
    } else {
      response.json(users);
    }
  });

  const middleware = MiddlewareFactory.create({ logger, config });

  router.use(middleware.error());
  return router;
}

export function rowToResponse(
  userInfoRow: UserInfoRow,
  tokenExpirationSeconds: number,
): UserInfoResponse {
  let tokenExpirationDate = DateTime.fromSQL(userInfoRow.updated_at, {
    zone: 'utc',
  });

  if (!tokenExpirationDate.isValid) {
    tokenExpirationDate = DateTime.fromJSDate(
      new Date(userInfoRow.updated_at),
      {
        zone: 'utc',
      },
    );
  }

  // Validate the date
  if (!tokenExpirationDate.isValid) {
    throw new Error(
      'Failed to parse expiration date format in userInfoRow.updated_at',
    );
  }

  const tokenExpirationMillis = tokenExpirationSeconds * 1000;
  const tokenIssuedTime =
    tokenExpirationDate.toMillis() - tokenExpirationMillis;
  return {
    userEntityRef: userInfoRow.user_entity_ref,
    lastAuthTime: new Date(tokenIssuedTime).toUTCString(),
  };
}

export async function permissionCheck(
  permissions: PermissionsService,
  credentials: BackstageCredentials,
) {
  const decision = (
    await permissions.authorize(
      [
        {
          permission: policyEntityReadPermission,
          resourceRef: policyEntityReadPermission.resourceType,
        },
      ],
      {
        credentials,
      },
    )
  )[0];

  if (decision.result === AuthorizeResult.DENY) {
    throw new NotAllowedError('Unauthorized');
  }
}

async function isSqliteInMemory(config: RootConfigService): Promise<boolean> {
  const databaseConfig = config.getOptionalConfig('backend.database');
  const dbClient = databaseConfig?.getOptionalString('client');

  const isSqlite =
    dbClient && (dbClient === 'sqlite3' || dbClient === 'better-sqlite3');

  const connection = databaseConfig?.getOptional('connection')?.valueOf();
  const isDirectoryStorageEnabled =
    typeof connection === 'object' &&
    Object.keys(connection).includes('directory');
  if (isSqlite && !isDirectoryStorageEnabled) {
    return true;
  }

  return false;
}
