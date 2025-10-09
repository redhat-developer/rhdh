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
import { useTranslation } from '../../hooks/useTranslation';

const DEFAULT_PROVIDER = 'github';

/**
 * Creates provider configurations with translated strings
 *
 * t - Translation function.
 * Map of provider configurations.
 *
 * Key:
 * string - Provider name.
 *
 * Value:
 * SignInProviderConfig - Local sign-in provider configuration.
 * string - Proxy sign-in provider configuration.
 *  */
const createProviders = (t: (key: string, params?: any) => string) =>
  new Map<string, SignInProviderConfig | string>([
    [
      'auth0',
      {
        id: 'auth0-auth-provider',
        title: t('signIn.providers.auth0.title'),
        message: t('signIn.providers.auth0.message'),
        apiRef: auth0AuthApiRef,
      },
    ],
    [
      'atlassian',
      {
        id: 'atlassian-auth-provider',
        title: t('signIn.providers.atlassian.title'),
        message: t('signIn.providers.atlassian.message'),
        apiRef: atlassianAuthApiRef,
      },
    ],
    [
      'microsoft',
      {
        id: 'microsoft-auth-provider',
        title: t('signIn.providers.microsoft.title'),
        message: t('signIn.providers.microsoft.message'),
        apiRef: microsoftAuthApiRef,
      },
    ],
    ['azure-easyauth', 'azure-easyauth'],
    [
      'bitbucket',
      {
        id: 'bitbucket-auth-provider',
        title: t('signIn.providers.bitbucket.title'),
        message: t('signIn.providers.bitbucket.message'),
        apiRef: bitbucketAuthApiRef,
      },
    ],
    [
      'bitbucketServer',
      {
        id: 'bitbucket-server-auth-provider',
        title: t('signIn.providers.bitbucketServer.title'),
        message: t('signIn.providers.bitbucketServer.message'),
        apiRef: bitbucketServerAuthApiRef,
      },
    ],
    ['cfaccess', 'cfaccess'],
    [
      'github',
      {
        id: 'github-auth-provider',
        title: t('signIn.providers.github.title'),
        message: t('signIn.providers.github.message'),
        apiRef: githubAuthApiRef,
      },
    ],
    [
      'gitlab',
      {
        id: 'gitlab-auth-provider',
        title: t('signIn.providers.gitlab.title'),
        message: t('signIn.providers.gitlab.message'),
        apiRef: gitlabAuthApiRef,
      },
    ],
    [
      'google',
      {
        id: 'google-auth-provider',
        title: t('signIn.providers.google.title'),
        message: t('signIn.providers.google.message'),
        apiRef: googleAuthApiRef,
      },
    ],
    ['gcp-iap', 'gcp-iap'],
    [
      'oidc',
      {
        id: 'oidc-auth-provider',
        title: t('signIn.providers.oidc.title'),
        message: t('signIn.providers.oidc.message'),
        apiRef: oidcAuthApiRef,
      },
    ],
    [
      'okta',
      {
        id: 'okta-auth-provider',
        title: t('signIn.providers.okta.title'),
        message: t('signIn.providers.okta.message'),
        apiRef: oktaAuthApiRef,
      },
    ],
    ['oauth2Proxy', 'oauth2Proxy'],
    [
      'onelogin',
      {
        id: 'onelogin-auth-provider',
        title: t('signIn.providers.onelogin.title'),
        message: t('signIn.providers.onelogin.message'),
        apiRef: oneloginAuthApiRef,
      },
    ],
    [
      'saml',
      {
        id: 'saml-auth-provider',
        title: t('signIn.providers.saml.title'),
        message: t('signIn.providers.saml.message'),
        apiRef: samlAuthApiRef,
      },
    ],
  ]);

export function SignInPage(props: SignInPageProps): React.JSX.Element {
  const configApi = useApi(configApiRef);
  const { t } = useTranslation();
  const isDevEnv = configApi.getString('auth.environment') === 'development';
  const provider =
    configApi.getOptionalString('signInPage') ?? DEFAULT_PROVIDER;

  const providers = createProviders(t);
  const providerConfig =
    providers.get(provider) ?? providers.get(DEFAULT_PROVIDER)!;

  if (typeof providerConfig === 'object') {
    const providerList = isDevEnv
      ? (['guest', providerConfig] satisfies ['guest', SignInProviderConfig])
      : [providerConfig];

    return (
      <CCSignInPage
        {...props}
        title={t('signIn.page.title')}
        align="center"
        providers={providerList}
      />
    );
  }

  return <ProxiedSignInPage {...props} provider={providerConfig} />;
}
