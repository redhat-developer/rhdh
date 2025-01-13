import { AuthResolverContext } from '@backstage/plugin-auth-node';

import { signInWithCatalogUserOptional } from './authProvidersModule';

jest.mock('@backstage/config-loader', () => ({
  ConfigSources: {
    default: jest.fn(),
    toConfig: jest.fn().mockResolvedValue({
      getOptionalBoolean: jest.fn().mockReturnValue(false), // mock dangerouslyAllowSignInWithoutUserInCatalog to false by default
    }),
  },
}));

describe('signInWithCatalogUserOptional', () => {
  let ctx: jest.Mocked<AuthResolverContext>;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = {
      issueToken: jest.fn().mockResolvedValue({
        token: 'issuedBackstageUserToken',
      }),
      findCatalogUser: jest.fn(),
      signInWithCatalogUser: jest.fn().mockResolvedValue({
        token: 'backstageToken',
      }),
    };
  });

  it('should return the signedInUser with token if the user exists in the catalog', async () => {
    const signedInUser = await signInWithCatalogUserOptional('test-user', ctx);

    expect(ctx.signInWithCatalogUser).toHaveBeenCalledWith({
      entityRef: { name: 'test-user' },
    });

    expect(signedInUser).toEqual({ token: 'backstageToken' });
  });

  it('should issue a token if the user does not exist in catalog and dangerouslyAllowSignInWithoutUserInCatalog is false (by default)', async () => {
    (ctx.signInWithCatalogUser as jest.Mock).mockRejectedValue(
      new Error('User not found'),
    );

    await expect(
      signInWithCatalogUserOptional('test-user', ctx),
    ).rejects.toThrow(
      `Sign in failed: User not found in the RHDH software catalog. Verify that users/groups are synchronized to the software catalog. For non-production environments, manually provision the user or disable the user provisioning requirement. Refer to the RHDH Authentication documentation for further details.`,
    );

    expect(ctx.signInWithCatalogUser).toHaveBeenCalledWith({
      entityRef: { name: 'test-user' },
    });
  });

  it('should issue a token if the user does not exist in catalog and dangerouslyAllowSignInWithoutUserInCatalog is true', async () => {
    const { ConfigSources } = require('@backstage/config-loader');
    ConfigSources.toConfig.mockResolvedValue({
      getOptionalBoolean: jest.fn().mockReturnValue(true),
    });
    (ctx.signInWithCatalogUser as jest.Mock).mockRejectedValue(
      new Error('User not found'),
    );

    const result = await signInWithCatalogUserOptional('test-user', ctx);
    expect(ctx.issueToken).toHaveBeenCalledWith({
      claims: {
        sub: 'user:default/test-user',
        ent: ['user:default/test-user'],
      },
    });

    expect(result).toEqual({ token: 'issuedBackstageUserToken' });
  });
});
