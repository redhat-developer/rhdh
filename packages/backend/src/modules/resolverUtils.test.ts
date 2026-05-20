import type { OidcAuthResult } from '@backstage/plugin-auth-backend-module-oidc-provider';
import {
  AuthResolverContext,
  BackstageSignInResult,
  OAuthAuthenticatorResult,
  SignInInfo,
  SignInResolver,
} from '@backstage/plugin-auth-node';

import { decodeJwt } from 'jose';

import {
  createOidcSubClaimResolver,
  OidcProviderInfo,
  trySignInResolvers,
} from './resolverUtils';

jest.mock('jose', () => ({ decodeJwt: jest.fn() }));

const decodeJwtMock = decodeJwt as jest.Mock;

const signInResult = { token: 'mock-token' } as BackstageSignInResult;

const buildContext = () =>
  ({
    signInWithCatalogUser: jest.fn().mockResolvedValue(signInResult),
  }) as unknown as AuthResolverContext;

const KEYCLOAK: OidcProviderInfo = {
  userIdKey: 'keycloak.org/id',
  providerName: 'Keycloak',
};

const buildOidcInfo = (sub?: string, idToken?: string) =>
  ({
    result: {
      fullProfile: {
        userinfo: { sub },
        tokenset: { id_token: idToken },
      },
    },
  }) as unknown as SignInInfo<OAuthAuthenticatorResult<OidcAuthResult>>;

describe('createOidcSubClaimResolver', () => {
  beforeEach(() => jest.clearAllMocks());

  it('signs in with the provider annotation when sub matches the id token', async () => {
    decodeJwtMock.mockReturnValue({ sub: 'user-123' });
    const ctx = buildContext();
    const resolver = createOidcSubClaimResolver(KEYCLOAK)();

    const result = await resolver(buildOidcInfo('user-123', 'id.token'), ctx);

    expect(result).toBe(signInResult);
    expect(ctx.signInWithCatalogUser).toHaveBeenCalledWith(
      { annotations: { 'keycloak.org/id': 'user-123' } },
      { dangerousEntityRefFallback: undefined },
    );
  });

  it('throws when the sub claim is missing', async () => {
    const resolver = createOidcSubClaimResolver(KEYCLOAK)();

    await expect(
      resolver(buildOidcInfo(undefined, 'id.token'), buildContext()),
    ).rejects.toThrow(/missing a 'sub' claim/);
  });

  it('throws when the id token is missing', async () => {
    const resolver = createOidcSubClaimResolver(KEYCLOAK)();

    await expect(
      resolver(buildOidcInfo('user-123', undefined), buildContext()),
    ).rejects.toThrow(/user ID token from Keycloak is missing/);
  });

  it('throws when the sub claim does not match the id token', async () => {
    decodeJwtMock.mockReturnValue({ sub: 'someone-else' });
    const resolver = createOidcSubClaimResolver(KEYCLOAK)();

    await expect(
      resolver(buildOidcInfo('user-123', 'id.token'), buildContext()),
    ).rejects.toThrow(/mismatching 'sub' claim/);
  });

  it('passes a dangerous entity ref fallback when explicitly allowed', async () => {
    decodeJwtMock.mockReturnValue({ sub: 'user-123' });
    const ctx = buildContext();
    const resolver = createOidcSubClaimResolver(KEYCLOAK)({
      dangerouslyAllowSignInWithoutUserInCatalog: true,
    });

    await resolver(buildOidcInfo('user-123', 'id.token'), ctx);

    expect(ctx.signInWithCatalogUser).toHaveBeenCalledWith(
      { annotations: { 'keycloak.org/id': 'user-123' } },
      { dangerousEntityRefFallback: { entityRef: 'user-123' } },
    );
  });
});

describe('trySignInResolvers', () => {
  const info = {} as SignInInfo<unknown>;
  const ctx = {} as AuthResolverContext;

  it('returns the result of the first resolver that succeeds', async () => {
    const first: SignInResolver<unknown> = jest
      .fn()
      .mockResolvedValue(signInResult);
    const second: SignInResolver<unknown> = jest.fn();

    const result = await trySignInResolvers([first, second])(info, ctx);

    expect(result).toBe(signInResult);
    expect(second).not.toHaveBeenCalled();
  });

  it('skips failing resolvers and uses the next that succeeds', async () => {
    const failing: SignInResolver<unknown> = jest
      .fn()
      .mockRejectedValue(new Error('no match'));
    const succeeding: SignInResolver<unknown> = jest
      .fn()
      .mockResolvedValue(signInResult);

    const result = await trySignInResolvers([failing, succeeding])(info, ctx);

    expect(result).toBe(signInResult);
    expect(failing).toHaveBeenCalled();
    expect(succeeding).toHaveBeenCalled();
  });

  it('throws a descriptive error when every resolver fails', async () => {
    const failing: SignInResolver<unknown> = jest
      .fn()
      .mockRejectedValue(new Error('no match'));

    await expect(
      trySignInResolvers([failing, failing])(info, ctx),
    ).rejects.toThrow(/unable to resolve user identity/);
  });
});
