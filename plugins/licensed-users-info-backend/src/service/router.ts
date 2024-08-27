import { MiddlewareFactory } from '@backstage/backend-defaults/rootHttpRouter';
import {
  AuthService,
  BackstageCredentials,
  DiscoveryService,
  HttpAuthService,
  PermissionsService,
  RootConfigService,
} from '@backstage/backend-plugin-api';
import { LoggerService } from '@backstage/backend-plugin-api';
import express from 'express';
import Router from 'express-promise-router';
import { DatabaseManager } from '@backstage/backend-defaults/database';
import {
  DatabaseUserInfoStore,
  UserInfoRow,
} from '../database/databaseUserInfoStore';
import { CatalogEntityStore } from './catalogStore';
import { readBackstageTokenExpiration } from './readBackstageTokenExpiration';
import { json2csv } from 'json-2-csv';
import { CatalogClient } from '@backstage/catalog-client';
import { NotAllowedError } from '@backstage/errors';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { policyEntityReadPermission } from '@janus-idp/backstage-plugin-rbac-common';
import { DateTime } from 'luxon';

export interface RouterOptions {
  logger: LoggerService;
  config: RootConfigService;
  auth: AuthService;
  discovery: DiscoveryService;
  permissions: PermissionsService;
  httpAuth: HttpAuthService;
}

export type UserInfoResponse = {
  // firstTimeLogin: string;
  userEntityRef: string;
  displayName?: string;
  email?: string;
  lastTimeLogin: string;
};

export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { logger, config, auth, discovery, permissions, httpAuth } = options;

  const tokenExpiration = readBackstageTokenExpiration(config);

  const authDB = await DatabaseManager.fromConfig(options.config)
    .forPlugin('auth')
    .getClient();

  const catalogClient = new CatalogClient({ discoveryApi: discovery });

  const userInfoStore = new DatabaseUserInfoStore(authDB);
  const catalogEntityStore = new CatalogEntityStore(catalogClient, auth);

  const router = Router();
  router.use(express.json());

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
      if (entity && entity.spec && entity.spec.profile) {
        userInfo.displayName = (entity.spec.profile as any)
          .displayName as string;
        userInfo.email = (entity.spec.profile as any).email as string;
      }
    }

    if (request.headers['content-type']?.includes('text/csv')) {
      try {
        const csv = await json2csv(users, {
          keys: ['userEntityRef', 'displayName', 'email', 'lastTimeLogin'],
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
  const tokenExpirationDate = DateTime.fromSQL(userInfoRow.exp, {
    zone: 'utc',
  });
  // Validate the date
  if (!tokenExpirationDate.isValid) {
    throw new Error('Invalid expiration date format in userInfoRow.exp');
  }

  const tokenExpirationMillis = tokenExpirationSeconds * 1000;
  const tokenIssuedTime =
    tokenExpirationDate.toMillis() - tokenExpirationMillis;
  return {
    userEntityRef: userInfoRow.user_entity_ref,
    lastTimeLogin: new Date(tokenIssuedTime).toUTCString(),
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
