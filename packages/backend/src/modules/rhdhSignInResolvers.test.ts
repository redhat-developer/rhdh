import type { OAuth2ProxyResult } from '@backstage/plugin-auth-backend-module-oauth2-proxy-provider';
import type { OidcAuthResult } from '@backstage/plugin-auth-backend-module-oidc-provider';
import {
  AuthResolverContext,
  BackstageSignInResult,
  OAuthAuthenticatorResult,
  SignInInfo,
} from '@backstage/plugin-auth-node';

import { decodeJwt } from 'jose';

import { rhdhSignInResolvers } from './rhdhSignInResolvers';

jest.mock('jose', () => ({ decodeJwt: jest.fn() }));

const decodeJwtMock = decodeJwt as jest.Mock;

const signInResult = { token: 'mock-token' } as BackstageSignInResult;

const buildContext = () =>
  ({
    signInWithCatalogUser: jest.fn().mockResolvedValue(signInResult),
  }) as unknown as AuthResolverContext;

const buildOidcInfo = (userinfo: Record<string, unknown>, idToken?: string) =>
  ({
    result: {
      fullProfile: {
        userinfo,
        tokenset: { id_token: idToken },
      },
    },
  }) as unknown as SignInInfo<OAuthAuthenticatorResult<OidcAuthResult>>;

const buildProxyInfo = (headers: Record<string, string | undefined>) =>
  ({
    result: {
      getHeader: (name: string) => headers[name],
    },
  }) as unknown as SignInInfo<OAuth2ProxyResult>;

beforeEach(() => jest.clearAllMocks());

describe('preferredUsernameMatchingUserEntityName', () => {
  it('signs in using the preferred_username as the entity name', async () => {
    const ctx = buildContext();
    const resolver =
      rhdhSignInResolvers.preferredUsernameMatchingUserEntityName();

    await resolver(buildOidcInfo({ preferred_username: 'jdoe' }), ctx);

    expect(ctx.signInWithCatalogUser).toHaveBeenCalledWith(
      { entityRef: { name: 'jdoe' } },
      { dangerousEntityRefFallback: undefined },
    );
  });

  it('throws when the profile has no username', async () => {
    const resolver =
      rhdhSignInResolvers.preferredUsernameMatchingUserEntityName();

    await expect(resolver(buildOidcInfo({}), buildContext())).rejects.toThrow(
      'OIDC user profile does not contain a username',
    );
  });

  it('passes a fallback entity ref when explicitly allowed', async () => {
    const ctx = buildContext();
    const resolver =
      rhdhSignInResolvers.preferredUsernameMatchingUserEntityName({
        dangerouslyAllowSignInWithoutUserInCatalog: true,
      });

    await resolver(buildOidcInfo({ preferred_username: 'jdoe' }), ctx);

    expect(ctx.signInWithCatalogUser).toHaveBeenCalledWith(
      { entityRef: { name: 'jdoe' } },
      { dangerousEntityRefFallback: { entityRef: 'jdoe' } },
    );
  });
});

describe('oauth2ProxyUserHeaderMatchingUserEntityName', () => {
  const ORIGINAL_HEADER_ENV = process.env.OAUTH_USER_HEADER;

  afterEach(() => {
    if (ORIGINAL_HEADER_ENV === undefined) {
      delete process.env.OAUTH_USER_HEADER;
    } else {
      process.env.OAUTH_USER_HEADER = ORIGINAL_HEADER_ENV;
    }
  });

  it('reads the user from the configured OAUTH_USER_HEADER', async () => {
    process.env.OAUTH_USER_HEADER = 'x-custom-user';
    const ctx = buildContext();
    const resolver =
      rhdhSignInResolvers.oauth2ProxyUserHeaderMatchingUserEntityName();

    await resolver(buildProxyInfo({ 'x-custom-user': 'alice' }), ctx);

    expect(ctx.signInWithCatalogUser).toHaveBeenCalledWith(
      { entityRef: { name: 'alice' } },
      { dangerousEntityRefFallback: undefined },
    );
  });

  it('prefers x-forwarded-preferred-username over x-forwarded-user', async () => {
    delete process.env.OAUTH_USER_HEADER;
    const ctx = buildContext();
    const resolver =
      rhdhSignInResolvers.oauth2ProxyUserHeaderMatchingUserEntityName();

    await resolver(
      buildProxyInfo({
        'x-forwarded-preferred-username': 'preferred',
        'x-forwarded-user': 'fallback',
      }),
      ctx,
    );

    expect(ctx.signInWithCatalogUser).toHaveBeenCalledWith(
      { entityRef: { name: 'preferred' } },
      { dangerousEntityRefFallback: undefined },
    );
  });

  it('falls back to x-forwarded-user when preferred-username is absent', async () => {
    delete process.env.OAUTH_USER_HEADER;
    const ctx = buildContext();
    const resolver =
      rhdhSignInResolvers.oauth2ProxyUserHeaderMatchingUserEntityName();

    await resolver(buildProxyInfo({ 'x-forwarded-user': 'carol' }), ctx);

    expect(ctx.signInWithCatalogUser).toHaveBeenCalledWith(
      { entityRef: { name: 'carol' } },
      { dangerousEntityRefFallback: undefined },
    );
  });

  it('throws when no user header is present', async () => {
    delete process.env.OAUTH_USER_HEADER;
    const resolver =
      rhdhSignInResolvers.oauth2ProxyUserHeaderMatchingUserEntityName();

    await expect(resolver(buildProxyInfo({}), buildContext())).rejects.toThrow(
      'Request did not contain a user',
    );
  });

  it('passes a fallback entity ref when explicitly allowed', async () => {
    delete process.env.OAUTH_USER_HEADER;
    const ctx = buildContext();
    const resolver =
      rhdhSignInResolvers.oauth2ProxyUserHeaderMatchingUserEntityName({
        dangerouslyAllowSignInWithoutUserInCatalog: true,
      });

    await resolver(
      buildProxyInfo({ 'x-forwarded-preferred-username': 'bob' }),
      ctx,
    );

    expect(ctx.signInWithCatalogUser).toHaveBeenCalledWith(
      { entityRef: { name: 'bob' } },
      { dangerousEntityRefFallback: { entityRef: 'bob' } },
    );
  });
});

describe('oidcLdapUuidMatchingAnnotation', () => {
  it('signs in with the ldap-uuid annotation when the uuid matches the id token', async () => {
    decodeJwtMock.mockReturnValue({ ldap_uuid: 'uuid-1' });
    const ctx = buildContext();
    const resolver = rhdhSignInResolvers.oidcLdapUuidMatchingAnnotation();

    await resolver(buildOidcInfo({ ldap_uuid: 'uuid-1' }, 'id.token'), ctx);

    expect(ctx.signInWithCatalogUser).toHaveBeenCalledWith(
      { annotations: { 'backstage.io/ldap-uuid': 'uuid-1' } },
      { dangerousEntityRefFallback: undefined },
    );
  });

  it('honors a custom ldapUuidKey option', async () => {
    decodeJwtMock.mockReturnValue({ custom_uuid: 'uuid-2' });
    const ctx = buildContext();
    const resolver = rhdhSignInResolvers.oidcLdapUuidMatchingAnnotation({
      ldapUuidKey: 'custom_uuid',
    });

    await resolver(buildOidcInfo({ custom_uuid: 'uuid-2' }, 'id.token'), ctx);

    expect(ctx.signInWithCatalogUser).toHaveBeenCalledWith(
      { annotations: { 'backstage.io/ldap-uuid': 'uuid-2' } },
      { dangerousEntityRefFallback: undefined },
    );
  });

  it('throws when the uuid is missing', async () => {
    const resolver = rhdhSignInResolvers.oidcLdapUuidMatchingAnnotation();

    await expect(
      resolver(buildOidcInfo({}, 'id.token'), buildContext()),
    ).rejects.toThrow(/missing the UUID/);
  });

  it('throws when the id token is missing', async () => {
    const resolver = rhdhSignInResolvers.oidcLdapUuidMatchingAnnotation();

    await expect(
      resolver(
        buildOidcInfo({ ldap_uuid: 'uuid-1' }, undefined),
        buildContext(),
      ),
    ).rejects.toThrow(/user ID token from LDAP is missing/);
  });

  it('throws when the uuid does not match the id token', async () => {
    decodeJwtMock.mockReturnValue({ ldap_uuid: 'someone-else' });
    const resolver = rhdhSignInResolvers.oidcLdapUuidMatchingAnnotation();

    await expect(
      resolver(
        buildOidcInfo({ ldap_uuid: 'uuid-1' }, 'id.token'),
        buildContext(),
      ),
    ).rejects.toThrow(/mismatching UUID/);
  });

  it('passes a fallback entity ref when explicitly allowed', async () => {
    decodeJwtMock.mockReturnValue({ ldap_uuid: 'uuid-1' });
    const ctx = buildContext();
    const resolver = rhdhSignInResolvers.oidcLdapUuidMatchingAnnotation({
      dangerouslyAllowSignInWithoutUserInCatalog: true,
    });

    await resolver(buildOidcInfo({ ldap_uuid: 'uuid-1' }, 'id.token'), ctx);

    expect(ctx.signInWithCatalogUser).toHaveBeenCalledWith(
      { annotations: { 'backstage.io/ldap-uuid': 'uuid-1' } },
      { dangerousEntityRefFallback: { entityRef: 'uuid-1' } },
    );
  });
});

describe('oidc sub-claim resolvers', () => {
  it('matches Keycloak users on the keycloak.org/id annotation', async () => {
    decodeJwtMock.mockReturnValue({ sub: 'kc-1' });
    const ctx = buildContext();
    const resolver = rhdhSignInResolvers.oidcSubClaimMatchingKeycloakUserId();

    await resolver(buildOidcInfo({ sub: 'kc-1' }, 'id.token'), ctx);

    expect(ctx.signInWithCatalogUser).toHaveBeenCalledWith(
      { annotations: { 'keycloak.org/id': 'kc-1' } },
      { dangerousEntityRefFallback: undefined },
    );
  });

  it('matches Ping Identity users on the pingidentity.org/id annotation', async () => {
    decodeJwtMock.mockReturnValue({ sub: 'ping-1' });
    const ctx = buildContext();
    const resolver =
      rhdhSignInResolvers.oidcSubClaimMatchingPingIdentityUserId();

    await resolver(buildOidcInfo({ sub: 'ping-1' }, 'id.token'), ctx);

    expect(ctx.signInWithCatalogUser).toHaveBeenCalledWith(
      { annotations: { 'pingidentity.org/id': 'ping-1' } },
      { dangerousEntityRefFallback: undefined },
    );
  });
});
