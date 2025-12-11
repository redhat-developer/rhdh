import type { OidcAuthResult } from '@backstage/plugin-auth-backend-module-oidc-provider';
import {
  AuthResolverContext,
  createSignInResolverFactory,
  OAuthAuthenticatorResult,
  SignInInfo,
  SignInResolver,
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
 * @param userIdKey - The annotation key to match the user's `sub` claim.
 * @param providerName - The name of the identity provider to report in error message if the `sub` claim is missing.
 */
export const createOidcSubClaimResolver = (provider: OidcProviderInfo) =>
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
