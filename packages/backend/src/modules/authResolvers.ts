import type { OAuth2ProxyResult } from '@backstage/plugin-auth-backend-module-oauth2-proxy-provider';
import type { OidcAuthResult } from '@backstage/plugin-auth-backend-module-oidc-provider';
import {
  AuthResolverContext,
  createSignInResolverFactory,
  OAuthAuthenticatorResult,
  PassportProfile,
  SignInInfo,
} from '@backstage/plugin-auth-node';

import { decodeJwt } from 'jose';
import { Octokit } from 'octokit';
import { z } from 'zod';

export type OidcProviderInfo = {
  userIdKey: string;
  providerName: string;
};

// This splits an email "joe+work@acme.com" into ["joe", "+work", "@acme.com"]
// so that we can remove the plus addressing. May output a shorter array:
// ["joe", "@acme.com"], if no plus addressing was found.
const reEmail = /^([^@+]+)(\+[^@]+)?(@.*)$/;

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

  /**
   * A GitHub resolver that looks up the user using the user's GitHub email.
   * It will query for the user's private email if no email is found in the auth response.
   */
  export const gitHubPrivateEmailMatchingUserEntityProfileEmail =
    createSignInResolverFactory({
      optionsSchema: z
        .object({
          dangerouslyAllowSignInWithoutUserInCatalog: z.boolean().optional(),
        })
        .optional(),
      create(options) {
        return async (
          info: SignInInfo<OAuthAuthenticatorResult<PassportProfile>>,
          ctx: AuthResolverContext,
        ) => {
          const { profile } = info;

          if (!profile.email) {
            // GitHub email may be private, make a request to get list of user's private emails
            const octokit = new Octokit({
              auth: info.result.session.accessToken,
            });

            const res = await octokit.request('GET /user/emails', {
              headers: {
                'X-GitHub-Api-Version': '2022-11-28',
              },
            });

            if (res.data.length === 0) {
              throw new Error(
                'Failed to sign-in, unable to resolve user identity. Could not get emails in user profile.',
              );
            }

            const usersWithVerifiedEmails = res.data.filter(
              email => email.verified,
            );
            if (!usersWithVerifiedEmails) {
              throw new Error(
                'Failed to sign-in, unable to resolve user identity. No verified emails were found.',
              );
            }
            for (const user of usersWithVerifiedEmails) {
              try {
                return await ctx.signInWithCatalogUser(
                  {
                    filter: {
                      'spec.profile.email': user.email,
                    },
                  },
                  user.email,
                  options?.dangerouslyAllowSignInWithoutUserInCatalog,
                );
              } catch (error: any) {
                // do nothing, try the next email
              }
            }
          } else {
            // Same as upstream emailMatchingUserEntityProfileEmail resolver
            try {
              return await ctx.signInWithCatalogUser({
                filter: {
                  'spec.profile.email': profile.email,
                },
              });
            } catch (err: any) {
              if (err?.name === 'NotFoundError') {
                // Try removing the plus addressing from the email address
                const m = profile.email.match(reEmail);
                if (m?.length === 4) {
                  const [_, name, _plus, domain] = m;
                  const noPlusEmail = `${name}${domain}`;

                  return ctx.signInWithCatalogUser(
                    {
                      filter: {
                        'spec.profile.email': noPlusEmail,
                      },
                    },
                    noPlusEmail,
                    options?.dangerouslyAllowSignInWithoutUserInCatalog,
                  );
                }
              }
              // Email had no plus addressing or is missing in the catalog, forward failure
              throw err;
            }
          }
          throw new Error(
            'Failed to sign-in, unable to resolve user identity. Please verify that your catalog contains the expected user entities that would match your configured sign-in resolver.',
          );
        };
      },
    });
}
