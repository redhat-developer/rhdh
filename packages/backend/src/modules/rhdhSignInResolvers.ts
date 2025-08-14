import type { OAuth2ProxyResult } from '@backstage/plugin-auth-backend-module-oauth2-proxy-provider';
import type { OidcAuthResult } from '@backstage/plugin-auth-backend-module-oidc-provider';
import {
  AuthResolverContext,
  createSignInResolverFactory,
  OAuthAuthenticatorResult,
  SignInInfo,
} from '@backstage/plugin-auth-node';

import { decodeJwt } from 'jose';
import { z } from 'zod';

import { createOidcSubClaimResolver, OidcProviderInfo } from './resolverUtils';

const KEYCLOAK_INFO: OidcProviderInfo = {
  userIdKey: 'keycloak.org/id',
  providerName: 'Keycloak',
};

const PING_IDENTITY_INFO: OidcProviderInfo = {
  userIdKey: 'pingidentity.org/id',
  providerName: 'Ping Identity',
};

const LDAP_UUID_ANNOTATION = 'backstage.io/ldap-uuid';

/**
 * Additional RHDH specific sign-in resolvers.
 *
 * @public
 */
export namespace rhdhSignInResolvers {
  /**
   * A oidc resolver that looks up the user using their preferred username
   * as the entity name
   */
  export const preferredUsernameMatchingUserEntityName =
    createSignInResolverFactory({
      optionsSchema: z
        .object({
          dangerouslyAllowSignInWithoutUserInCatalog: z.boolean().optional(),
        })
        .optional(),
      create(options) {
        return async (
          info: SignInInfo<OAuthAuthenticatorResult<OidcAuthResult>>,
          ctx,
        ) => {
          const userId = info.result.fullProfile.userinfo.preferred_username;
          if (!userId) {
            throw new Error(`OIDC user profile does not contain a username`);
          }

          return ctx.signInWithCatalogUser(
            {
              entityRef: { name: userId },
            },
            {
              dangerousEntityRefFallback:
                options?.dangerouslyAllowSignInWithoutUserInCatalog
                  ? { entityRef: userId }
                  : undefined,
            },
          );
        };
      },
    });

  /**
   * An OIDC resolver that looks up the user using their Keycloak user ID.
   */
  export const oidcSubClaimMatchingKeycloakUserId =
    createOidcSubClaimResolver(KEYCLOAK_INFO);

  /**
   * An OIDC resolver that looks up the user using their Ping Identity user ID.
   */
  export const oidcSubClaimMatchingPingIdentityUserId =
    createOidcSubClaimResolver(PING_IDENTITY_INFO);

  /**
   * An oauth2proxy resolver that looks up the user using the OAUTH_USER_HEADER environment variable,
   * 'x-forwarded-preferred-username' or 'x-forwarded-user'.
   */
  export const oauth2ProxyUserHeaderMatchingUserEntityName =
    createSignInResolverFactory({
      optionsSchema: z
        .object({
          dangerouslyAllowSignInWithoutUserInCatalog: z.boolean().optional(),
        })
        .optional(),
      create(options) {
        return async (
          info: SignInInfo<OAuth2ProxyResult>,
          ctx: AuthResolverContext,
        ) => {
          const name = process.env.OAUTH_USER_HEADER
            ? info.result.getHeader(process.env.OAUTH_USER_HEADER)
            : info.result.getHeader('x-forwarded-preferred-username') ||
              info.result.getHeader('x-forwarded-user');
          if (!name) {
            throw new Error('Request did not contain a user');
          }
          return ctx.signInWithCatalogUser(
            {
              entityRef: { name },
            },
            {
              dangerousEntityRefFallback:
                options?.dangerouslyAllowSignInWithoutUserInCatalog
                  ? { entityRef: name }
                  : undefined,
            },
          );
        };
      },
    });

  export const oidcLdapUuidMatchingAnnotation = createSignInResolverFactory({
    optionsSchema: z
      .object({
        dangerouslyAllowSignInWithoutUserInCatalog: z.boolean().optional(),
        ldapUuidKey: z.string().optional(),
      })
      .optional(),
    create(options) {
      return async (
        info: SignInInfo<OAuthAuthenticatorResult<OidcAuthResult>>,
        ctx: AuthResolverContext,
      ) => {
        const uuidKey = options?.ldapUuidKey ?? 'ldap_uuid';
        const uuid = info.result.fullProfile.userinfo[uuidKey] as string;
        if (!uuid) {
          throw new Error(
            `The user profile from LDAP is missing the UUID, likely due to a misconfiguration in the provider. Please contact your system administrator for assistance.`,
          );
        }

        const idToken = info.result.fullProfile.tokenset.id_token;
        if (!idToken) {
          throw new Error(
            `The user ID token from LDAP is missing. Please contact your system administrator for assistance.`,
          );
        }

        const uuidFromIdToken = decodeJwt(idToken)?.[uuidKey];
        if (uuid !== uuidFromIdToken) {
          throw new Error(
            `There was a problem verifying your identity with LDAP due to mismatching UUID. Please contact your system administrator for assistance.`,
          );
        }

        return ctx.signInWithCatalogUser(
          {
            annotations: { [LDAP_UUID_ANNOTATION]: uuid },
          },
          {
            dangerousEntityRefFallback:
              options?.dangerouslyAllowSignInWithoutUserInCatalog
                ? { entityRef: uuid }
                : undefined,
          },
        );
      };
    },
  });
}
