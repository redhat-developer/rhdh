import type { OAuth2ProxyResult } from '@backstage/plugin-auth-backend-module-oauth2-proxy-provider';
import type { OidcAuthResult } from '@backstage/plugin-auth-backend-module-oidc-provider';
import {
  AuthResolverContext,
  createSignInResolverFactory,
  OAuthAuthenticatorResult,
  SignInInfo,
  SignInResolver,
  SignInResolverFactory,
} from '@backstage/plugin-auth-node';

import { decodeJwt } from 'jose';
import { z } from 'zod/v3';

export type OidcProviderInfo = {
  userIdKey: string;
  providerName: string;
};

export type SignInWithoutCatalogOptions = {
  dangerouslyAllowSignInWithoutUserInCatalog?: boolean;
};

export type OidcLdapUuidMatchingOptions = SignInWithoutCatalogOptions & {
  ldapUuidKey?: string;
};

/** Shared schema for optional sign-in resolver config. */
export const signInWithoutCatalogOptionsSchema = z
  .object({
    dangerouslyAllowSignInWithoutUserInCatalog: z.boolean().optional(),
  })
  .optional() as z.ZodType<SignInWithoutCatalogOptions | undefined>;

/** Shared schema for LDAP UUID sign-in resolver config. */
export const oidcLdapUuidMatchingOptionsSchema = z
  .object({
    dangerouslyAllowSignInWithoutUserInCatalog: z.boolean().optional(),
    ldapUuidKey: z.string().optional(),
  })
  .optional() as z.ZodType<OidcLdapUuidMatchingOptions | undefined>;

/**
 * Backstage 1.52+ `createSignInResolverFactory` triggers TS2589 when TypeScript
 * infers nested zod schemas. Keep these typed factory wrappers (do not call the
 * upstream helper directly with inline schemas).
 */
type SignInWithoutCatalogResolverFactory = SignInResolverFactory<
  OAuthAuthenticatorResult<OidcAuthResult>
>;

export const createSignInWithoutCatalogResolverFactory =
  createSignInResolverFactory as (options: {
    optionsSchema: z.ZodTypeAny;
    create(
      options?: SignInWithoutCatalogOptions,
    ): SignInResolver<OAuthAuthenticatorResult<OidcAuthResult>>;
  }) => SignInWithoutCatalogResolverFactory;

export const createOAuth2ProxySignInResolverFactory =
  createSignInResolverFactory as (options: {
    optionsSchema: z.ZodTypeAny;
    create(
      options?: SignInWithoutCatalogOptions,
    ): SignInResolver<OAuth2ProxyResult>;
  }) => SignInResolverFactory<OAuth2ProxyResult>;

export const createOidcLdapUuidMatchingResolverFactory =
  createSignInResolverFactory as (options: {
    optionsSchema: z.ZodTypeAny;
    create(
      options?: OidcLdapUuidMatchingOptions,
    ): SignInResolver<OAuthAuthenticatorResult<OidcAuthResult>>;
  }) => SignInWithoutCatalogResolverFactory;

/**
 * Creates an OIDC sign-in resolver that looks up the user using a specific annotation key.
 *
 * @param userIdKey - The annotation key to match the user's `sub` claim.
 * @param providerName - The name of the identity provider to report in error message if the `sub` claim is missing.
 */
export const createOidcSubClaimResolver = (
  provider: OidcProviderInfo,
): SignInWithoutCatalogResolverFactory =>
  createSignInWithoutCatalogResolverFactory({
    optionsSchema: signInWithoutCatalogOptionsSchema,
    create(options = {}) {
      return async (
        info: SignInInfo<OAuthAuthenticatorResult<OidcAuthResult>>,
        ctx: AuthResolverContext,
      ) => {
        const sub = info.result.fullProfile.userinfo.sub;
        if (!sub) {
          throw new Error(
            `The user profile from ${provider.providerName} is missing a 'sub' claim, likely due to a misconfiguration in the provider. Please contact your system administrator for assistance.`,
          );
        }

        const idToken = info.result.fullProfile.tokenset.id_token;
        if (!idToken) {
          throw new Error(
            `The user ID token from ${provider.providerName} is missing. Please contact your system administrator for assistance.`,
          );
        }

        const subFromIdToken = decodeJwt(idToken)?.sub;
        if (sub !== subFromIdToken) {
          throw new Error(
            `There was a problem verifying your identity with ${provider.providerName} due to a mismatching 'sub' claim. Please contact your system administrator for assistance.`,
          );
        }

        return await ctx.signInWithCatalogUser(
          {
            annotations: { [provider.userIdKey]: sub },
          },
          {
            dangerousEntityRefFallback:
              options?.dangerouslyAllowSignInWithoutUserInCatalog
                ? { entityRef: sub }
                : undefined,
          },
        );
      };
    },
  });

/**
 * Creates a sign in resolver that tries the provided list of sign in resolvers
 *
 * @param signInResolvers list of sign in resolvers to try
 */
export function trySignInResolvers<TAuthResult>(
  signInResolvers: SignInResolver<TAuthResult>[],
): SignInResolver<TAuthResult> {
  return async (profile, context) => {
    for (const resolver of Object.values(signInResolvers)) {
      try {
        return await resolver(profile, context);
      } catch (error) {
        continue;
      }
    }

    // same error message as in upstream readDeclarativeSignInResolver
    throw new Error(
      'Failed to sign-in, unable to resolve user identity. Please verify that your catalog contains the expected User entities that would match your configured sign-in resolver.',
    );
  };
}
