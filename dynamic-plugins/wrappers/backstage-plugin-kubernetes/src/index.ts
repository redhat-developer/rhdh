import {
  type ApiRef,
  type BackstageIdentityApi,
  type OAuthApi,
  type OpenIdConnectApi,
  type ProfileInfoApi,
  type SessionApi,
  createApiFactory,
  createApiRef,
  gitlabAuthApiRef,
  googleAuthApiRef,
  microsoftAuthApiRef,
  oktaAuthApiRef,
  oneloginAuthApiRef,
} from '@backstage/core-plugin-api';
import {
  KubernetesAuthProviders,
  kubernetesAuthProvidersApiRef,
} from '@backstage/plugin-kubernetes';

export * from '@backstage/plugin-kubernetes';

type CustomAuthApiRefType = OAuthApi &
  OpenIdConnectApi &
  ProfileInfoApi &
  BackstageIdentityApi &
  SessionApi;

const oidcAuthApiRef: ApiRef<CustomAuthApiRefType> = createApiRef({
  id: 'internal.auth.oidc',
});

export const kubernetesAuthApi = createApiFactory({
  api: kubernetesAuthProvidersApiRef,
  deps: {
    gitlabAuthApi: gitlabAuthApiRef,
    googleAuthApi: googleAuthApiRef,
    microsoftAuthApi: microsoftAuthApiRef,
    oidcAuthApi: oidcAuthApiRef,
    oktaAuthApi: oktaAuthApiRef,
    oneloginAuthApi: oneloginAuthApiRef,
  },
  factory: ({
    gitlabAuthApi,
    googleAuthApi,
    microsoftAuthApi,
    oktaAuthApi,
    oneloginAuthApi,
    oidcAuthApi,
  }) => {
    const oidcProviders = {
      gitlab: gitlabAuthApi,
      google: googleAuthApi,
      microsoft: microsoftAuthApi,
      okta: oktaAuthApi,
      onelogin: oneloginAuthApi,
      oidc: oidcAuthApi,
    };

    return new KubernetesAuthProviders({
      microsoftAuthApi,
      googleAuthApi,
      oidcProviders,
    });
  },
});
