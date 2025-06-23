import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import {
  atlassianAuthenticator,
  atlassianSignInResolvers,
} from '@backstage/plugin-auth-backend-module-atlassian-provider';
import { auth0Authenticator } from '@backstage/plugin-auth-backend-module-auth0-provider';
import {
  azureEasyAuthAuthenticator,
  azureEasyAuthSignInResolvers,
} from '@backstage/plugin-auth-backend-module-azure-easyauth-provider';
import {
  bitbucketAuthenticator,
  bitbucketSignInResolvers,
} from '@backstage/plugin-auth-backend-module-bitbucket-provider';
import {
  bitbucketServerAuthenticator,
  bitbucketServerSignInResolvers,
} from '@backstage/plugin-auth-backend-module-bitbucket-server-provider';
import {
  cloudflareAccessSignInResolvers,
  createCloudflareAccessAuthenticator,
} from '@backstage/plugin-auth-backend-module-cloudflare-access-provider';
import {
  gcpIapAuthenticator,
  gcpIapSignInResolvers,
} from '@backstage/plugin-auth-backend-module-gcp-iap-provider';
import {
  githubAuthenticator,
  githubSignInResolvers,
} from '@backstage/plugin-auth-backend-module-github-provider';
import {
  gitlabAuthenticator,
  gitlabSignInResolvers,
} from '@backstage/plugin-auth-backend-module-gitlab-provider';
import { googleAuthenticator } from '@backstage/plugin-auth-backend-module-google-provider';
import {
  microsoftAuthenticator,
  microsoftSignInResolvers,
} from '@backstage/plugin-auth-backend-module-microsoft-provider';
import {
  oauth2ProxyAuthenticator,
  oauth2ProxySignInResolvers,
} from '@backstage/plugin-auth-backend-module-oauth2-proxy-provider';
import {
  oidcAuthenticator,
  oidcSignInResolvers,
} from '@backstage/plugin-auth-backend-module-oidc-provider';
import {
  oktaAuthenticator,
  oktaSignInResolvers,
} from '@backstage/plugin-auth-backend-module-okta-provider';
import {
  oneLoginAuthenticator,
  oneLoginSignInResolvers,
} from '@backstage/plugin-auth-backend-module-onelogin-provider';
import {
  authOwnershipResolutionExtensionPoint,
  AuthProviderFactory,
  authProvidersExtensionPoint,
  commonSignInResolvers,
  createOAuthProviderFactory,
  createProxyAuthProviderFactory,
} from '@backstage/plugin-auth-node';

import { TransitiveGroupOwnershipResolver } from '../transitiveGroupOwnershipResolver';
import { trySignInResolvers } from './resolverUtils';
import { rhdhSignInResolvers } from './rhdhSignInResolvers';

function getAuthProviderFactory(
  providerId: string,
  disableIdentityResolution: boolean,
): AuthProviderFactory {
  const applySignInResolvers = (options: {
    signInResolver: any;
    signInResolverFactories: Record<string, any>;
  }) => (!disableIdentityResolution ? options : {});

  switch (providerId) {
    case 'atlassian':
      return createOAuthProviderFactory({
        authenticator: atlassianAuthenticator,
        ...applySignInResolvers({
          signInResolver:
            atlassianSignInResolvers.usernameMatchingUserEntityName(),
          signInResolverFactories: {
            ...atlassianSignInResolvers,
            ...commonSignInResolvers,
          },
        }),
      });
    case 'auth0':
      return createOAuthProviderFactory({
        authenticator: auth0Authenticator,
        ...applySignInResolvers({
          signInResolver:
            commonSignInResolvers.emailMatchingUserEntityProfileEmail(),
          signInResolverFactories: {
            ...commonSignInResolvers,
          },
        }),
      });
    case 'azure-easyauth':
      return createProxyAuthProviderFactory({
        authenticator: azureEasyAuthAuthenticator,
        ...applySignInResolvers({
          signInResolver:
            azureEasyAuthSignInResolvers.idMatchingUserEntityAnnotation(),
          signInResolverFactories: {
            ...azureEasyAuthSignInResolvers,
            ...commonSignInResolvers,
          },
        }),
      });
    case 'bitbucket':
      return createOAuthProviderFactory({
        authenticator: bitbucketAuthenticator,
        ...applySignInResolvers({
          signInResolver:
            bitbucketSignInResolvers.usernameMatchingUserEntityAnnotation(),
          signInResolverFactories: {
            ...bitbucketSignInResolvers,
            ...commonSignInResolvers,
          },
        }),
      });
    case 'bitbucketServer':
      return createOAuthProviderFactory({
        authenticator: bitbucketServerAuthenticator,
        ...applySignInResolvers({
          signInResolver:
            bitbucketServerSignInResolvers.emailMatchingUserEntityProfileEmail(),
          signInResolverFactories: {
            ...bitbucketServerSignInResolvers,
            ...commonSignInResolvers,
          },
        }),
      });
    case 'cfaccess':
      return createProxyAuthProviderFactory({
        authenticator: createCloudflareAccessAuthenticator(),
        ...applySignInResolvers({
          signInResolver:
            cloudflareAccessSignInResolvers.emailMatchingUserEntityProfileEmail(),
          signInResolverFactories: {
            ...cloudflareAccessSignInResolvers,
            ...commonSignInResolvers,
          },
        }),
      });
    case 'github':
      return createOAuthProviderFactory({
        authenticator: githubAuthenticator,
        ...applySignInResolvers({
          signInResolver:
            githubSignInResolvers.usernameMatchingUserEntityName(),
          signInResolverFactories: {
            ...githubSignInResolvers,
            ...commonSignInResolvers,
          },
        }),
      });
    case 'gitlab':
      return createOAuthProviderFactory({
        authenticator: gitlabAuthenticator,
        ...applySignInResolvers({
          signInResolver:
            gitlabSignInResolvers.usernameMatchingUserEntityName(),
          signInResolverFactories: {
            ...gitlabSignInResolvers,
            ...commonSignInResolvers,
          },
        }),
      });
    case 'google':
      return createOAuthProviderFactory({
        authenticator: googleAuthenticator,
        ...applySignInResolvers({
          signInResolver:
            commonSignInResolvers.emailLocalPartMatchingUserEntityName(),
          signInResolverFactories: {
            ...commonSignInResolvers,
          },
        }),
      });
    case 'gcp-iap':
      return createProxyAuthProviderFactory({
        authenticator: gcpIapAuthenticator,
        ...applySignInResolvers({
          signInResolver:
            gcpIapSignInResolvers.emailMatchingUserEntityAnnotation(),
          signInResolverFactories: {
            ...gcpIapSignInResolvers,
            ...commonSignInResolvers,
          },
        }),
      });
    case 'oauth2Proxy':
      return createProxyAuthProviderFactory({
        authenticator: oauth2ProxyAuthenticator,
        ...applySignInResolvers({
          signInResolver:
            rhdhSignInResolvers.oauth2ProxyUserHeaderMatchingUserEntityName(),
          signInResolverFactories: {
            ...oauth2ProxySignInResolvers,
            ...commonSignInResolvers,
          },
        }),
      });
    case 'oidc':
      return createOAuthProviderFactory({
        authenticator: oidcAuthenticator,
        ...applySignInResolvers({
          signInResolver: trySignInResolvers([
            rhdhSignInResolvers.oidcSubClaimMatchingKeycloakUserId(),
            rhdhSignInResolvers.oidcLdapUuidMatchingAnnotation(),
          ]),
          signInResolverFactories: {
            preferredUsernameMatchingUserEntityName:
              rhdhSignInResolvers.preferredUsernameMatchingUserEntityName,
            oidcSubClaimMatchingKeycloakUserId:
              rhdhSignInResolvers.oidcSubClaimMatchingKeycloakUserId,
            oidcSubClaimMatchingPingIdentityUserId:
              rhdhSignInResolvers.oidcSubClaimMatchingPingIdentityUserId,
            oidcLdapUuidMatchingAnnotation:
              rhdhSignInResolvers.oidcLdapUuidMatchingAnnotation,
            ...oidcSignInResolvers,
            ...commonSignInResolvers,
          },
        }),
      });
    case 'okta':
      return createOAuthProviderFactory({
        authenticator: oktaAuthenticator,
        ...applySignInResolvers({
          signInResolver:
            oktaSignInResolvers.emailMatchingUserEntityAnnotation(),
          signInResolverFactories: {
            ...oktaSignInResolvers,
            ...commonSignInResolvers,
          },
        }),
      });
    case 'onelogin':
      return createOAuthProviderFactory({
        authenticator: oneLoginAuthenticator,
        ...applySignInResolvers({
          signInResolver:
            oneLoginSignInResolvers.usernameMatchingUserEntityName(),
          signInResolverFactories: {
            ...oneLoginSignInResolvers,
            ...commonSignInResolvers,
          },
        }),
      });
    case 'microsoft':
      return createOAuthProviderFactory({
        authenticator: microsoftAuthenticator,
        ...applySignInResolvers({
          signInResolver:
            microsoftSignInResolvers.userIdMatchingUserEntityAnnotation(),
          signInResolverFactories: {
            ...microsoftSignInResolvers,
            ...commonSignInResolvers,
          },
        }),
      });
    default:
      throw new Error(`No auth provider found for ${providerId}`);
  }
}

const authProvidersModule = createBackendModule({
  pluginId: 'auth',
  moduleId: 'auth.providers',
  register(reg) {
    reg.registerInit({
      deps: {
        config: coreServices.rootConfig,
        authProviders: authProvidersExtensionPoint,
        authOwnershipResolution: authOwnershipResolutionExtensionPoint,
        logger: coreServices.logger,
        discovery: coreServices.discovery,
        auth: coreServices.auth,
      },
      async init({
        config,
        authProviders,
        authOwnershipResolution,
        logger,
        discovery,
        auth,
      }) {
        const providersConfig = config.getConfig('auth.providers');
        const authFactories: Record<string, AuthProviderFactory> = {};
        const environment =
          config.getOptionalString('auth.environment') ?? 'development';
        providersConfig
          .keys()
          .filter(key => key !== 'guest')
          .forEach(providerId => {
            const disableIdentityResolution =
              config.getOptionalBoolean(
                `auth.providers.${providerId}.${environment}.disableIdentityResolution`,
              ) ?? false;
            const factory = getAuthProviderFactory(
              providerId,
              disableIdentityResolution,
            );
            authFactories[providerId] = factory;
          });

        const providerFactories: Record<string, AuthProviderFactory> = {
          ...authFactories,
        };

        logger.info(
          `Enabled Provider Factories : ${JSON.stringify(providerFactories)}`,
        );
        const transitiveGroupOwnershipResolver =
          new TransitiveGroupOwnershipResolver({ discovery, config, auth });
        authOwnershipResolution.setAuthOwnershipResolver(
          transitiveGroupOwnershipResolver,
        );

        Object.entries(providerFactories).forEach(([providerId, factory]) => {
          authProviders.registerProvider({ providerId, factory });
        });
      },
    });
  },
});

export default authProvidersModule;
