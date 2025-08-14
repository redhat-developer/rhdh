import {
  SignInPage as CCSignInPage,
  ProxiedSignInPage,
  type SignInProviderConfig,
} from '@backstage/core-components';
import {
  atlassianAuthApiRef,
  bitbucketAuthApiRef,
  bitbucketServerAuthApiRef,
  configApiRef,
  githubAuthApiRef,
  gitlabAuthApiRef,
  googleAuthApiRef,
  microsoftAuthApiRef,
  oktaAuthApiRef,
  oneloginAuthApiRef,
  useApi,
  type SignInPageProps,
} from '@backstage/core-plugin-api';

import { auth0AuthApiRef, oidcAuthApiRef, samlAuthApiRef } from '../../api';

const DEFAULT_PROVIDER = 'github';

/**
 * Key:
 * string - Provider name.
 *
 * Value:
 * SignInProviderConfig - Local sign-in provider configuration.
 * string - Proxy sign-in provider configuration.
 */
const PROVIDERS = new Map<string, SignInProviderConfig | string>([
  [
    'auth0',
    {
      id: 'auth0-auth-provider',
      title: 'Auth0',
      message: 'Sign in using Auth0',
      apiRef: auth0AuthApiRef,
    },
  ],
  [
    'atlassian',
    {
      id: 'atlassian-auth-provider',
      title: 'Atlassian',
      message: 'Sign in using Atlassian',
      apiRef: atlassianAuthApiRef,
    },
  ],
  [
    'microsoft',
    {
      id: 'microsoft-auth-provider',
      title: 'Microsoft',
      message: 'Sign in using Microsoft',
      apiRef: microsoftAuthApiRef,
    },
  ],
  ['azure-easyauth', 'azure-easyauth'],
  [
    'bitbucket',
    {
      id: 'bitbucket-auth-provider',
      title: 'Bitbucket',
      message: 'Sign in using Bitbucket',
      apiRef: bitbucketAuthApiRef,
    },
  ],
  [
    'bitbucketServer',
    {
      id: 'bitbucket-server-auth-provider',
      title: 'Bitbucket Server',
      message: 'Sign in using Bitbucket Server',
      apiRef: bitbucketServerAuthApiRef,
    },
  ],
  ['cfaccess', 'cfaccess'],
  [
    'github',
    {
      id: 'github-auth-provider',
      title: 'GitHub',
      message: 'Sign in using GitHub',
      apiRef: githubAuthApiRef,
    },
  ],
  [
    'gitlab',
    {
      id: 'gitlab-auth-provider',
      title: 'GitLab',
      message: 'Sign in using GitLab',
      apiRef: gitlabAuthApiRef,
    },
  ],
  [
    'google',
    {
      id: 'google-auth-provider',
      title: 'Google',
      message: 'Sign in using Google',
      apiRef: googleAuthApiRef,
    },
  ],
  ['gcp-iap', 'gcp-iap'],
  [
    'oidc',
    {
      id: 'oidc-auth-provider',
      title: 'OIDC',
      message: 'Sign in using OIDC',
      apiRef: oidcAuthApiRef,
    },
  ],
  [
    'okta',
    {
      id: 'okta-auth-provider',
      title: 'Okta',
      message: 'Sign in using Okta',
      apiRef: oktaAuthApiRef,
    },
  ],
  ['oauth2Proxy', 'oauth2Proxy'],
  [
    'onelogin',
    {
      id: 'onelogin-auth-provider',
      title: 'OneLogin',
      message: 'Sign in using OneLogin',
      apiRef: oneloginAuthApiRef,
    },
  ],
  [
    'saml',
    {
      id: 'saml-auth-provider',
      title: 'SAML',
      message: 'Sign in using SAML',
      apiRef: samlAuthApiRef,
    },
  ],
]);

export function SignInPage(props: SignInPageProps): React.JSX.Element {
  const configApi = useApi(configApiRef);
  const isDevEnv = configApi.getString('auth.environment') === 'development';
  const provider =
    configApi.getOptionalString('signInPage') ?? DEFAULT_PROVIDER;
  const providerConfig =
    PROVIDERS.get(provider) ?? PROVIDERS.get(DEFAULT_PROVIDER)!;

  if (typeof providerConfig === 'object') {
    const providers = isDevEnv
      ? (['guest', providerConfig] satisfies ['guest', SignInProviderConfig])
      : [providerConfig];

    return (
      <CCSignInPage
        {...props}
        title="Select a sign-in method"
        align="center"
        providers={providers}
      />
    );
  }

  return <ProxiedSignInPage {...props} provider={providerConfig} />;
}
