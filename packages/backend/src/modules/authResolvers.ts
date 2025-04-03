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

export type OidcProviderInfo = {
  userIdKey: string;
  providerName: string;
};

/**
 * Creates an OIDC sign-in resolver that looks up the user using a specific annotation key.
 *
 * @param annotationKey - The annotation key to match the user's `sub` claim.
 * @param providerName - The name of the identity provider to report in error message if the `sub` claim is missing.
 */
const createOidcSubClaimResolver = (...providers: OidcProviderInfo[]) =>
  createSignInResolverFactory({
    optionsSchema: z
      .object({
        dangerouslyAllowSignInWithoutUserInCatalog: z.boolean().optional(),
      })
      .optional(),
    create(options) {
      return async (
        info: SignInInfo<OAuthAuthenticatorResult<OidcAuthResult>>,
        ctx: AuthResolverContext,
      ) => {
        for (const { userIdKey, providerName } of providers) {
          const sub = info.result.fullProfile.userinfo.sub;
          if (!sub) {
            throw new Error(
              `The user profile from ${providerName} is missing a 'sub' claim, likely due to a misconfiguration in the provider. Please contact your system administrator for assistance.`,
            );
          }

          const idToken = info.result.fullProfile.tokenset.id_token;
          if (!idToken) {
            throw new Error(
              `The user ID token from ${providerName} is missing a 'sub' claim, likely due to a misconfiguration in the provider. Please contact your system administrator for assistance.`,
            );
          }

          const subFromIdToken = decodeJwt(idToken)?.sub;
          if (sub !== subFromIdToken) {
            throw new Error(
              `There was a problem verifying your identity with ${providerName} due to a mismatching 'sub' claim. Please contact your system administrator for assistance.`,
            );
          }

          try {
            return await ctx.signInWithCatalogUser(
              {
                annotations: { [userIdKey]: sub },
              },
              sub,
              options?.dangerouslyAllowSignInWithoutUserInCatalog,
            );
          } catch (error: any) {
            if (error?.name === 'NotFoundError') {
              continue;
            }
            throw error;
          }
        }

        // same error message as in upstream readDeclarativeSignInResolver
        throw new Error(
          'Failed to sign-in, unable to resolve user identity. Please verify that your catalog contains the expected User entities that would match your configured sign-in resolver.',
        );
      };
    },
  });

const KEYCLOAK_ID_ANNOTATION = 'keycloak.org/id';
const PING_IDENTITY_ID_ANNOTATION = 'pingidentity.org/id';

const KEYCLOAK_INFO: OidcProviderInfo = {
  userIdKey: KEYCLOAK_ID_ANNOTATION,
  providerName: 'Keycloak',
};

const PING_IDENTITY_INFO: OidcProviderInfo = {
  userIdKey: PING_IDENTITY_ID_ANNOTATION,
  providerName: 'Ping Identity',
};

/**
 * Additional sign-in resolvers for the Oidc auth provider.
 *
 * @public
 */
export namespace rhdhSignInResolvers {
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
   * An OIDC resolver that looks up the user using the user ID of all supported OIDC identity providers.
   *
   * Note: this resolver should only be used for default statically defined resolver,
   * not to be used in app-config
   */
  export const oidcSubClaimMatchingIdPUserId = createOidcSubClaimResolver(
    KEYCLOAK_INFO,
    PING_IDENTITY_INFO,
  );

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
            name,
            options?.dangerouslyAllowSignInWithoutUserInCatalog,
          );
        };
      },
    });
}
