import { OAuth2, WebStorage } from '@backstage/core-app-api';
import {
  AnyApiFactory,
  bitbucketAuthApiRef,
  configApiRef,
  createApiFactory,
  discoveryApiRef,
  errorApiRef,
  fetchApiRef,
  githubAuthApiRef,
  gitlabAuthApiRef,
  identityApiRef,
  microsoftAuthApiRef,
  oauthRequestApiRef,
  storageApiRef,
} from '@backstage/core-plugin-api';
import {
  ScmAuth,
  scmAuthApiRef,
  ScmIntegrationsApi,
  scmIntegrationsApiRef,
} from '@backstage/integration-react';
import { UserSettingsStorage } from '@backstage/plugin-user-settings';

import {
  auth0AuthApiRef,
  oidcAuthApiRef,
  samlAuthApiRef,
} from './api/AuthApiRefs';
import {
  LearningPathApiClient,
  learningPathApiRef,
} from './api/LearningPathApiClient';

export const apis: AnyApiFactory[] = [
  createApiFactory({
    api: storageApiRef,
    deps: {
      discoveryApi: discoveryApiRef,
      errorApi: errorApiRef,
      fetchApi: fetchApiRef,
      identityApi: identityApiRef,
      configApi: configApiRef,
    },
    factory: deps => {
      const persistence =
        deps.configApi.getOptionalString('userSettings.persistence') ??
        'database';
      return persistence === 'browser'
        ? WebStorage.create(deps)
        : UserSettingsStorage.create(deps);
    },
  }),
  createApiFactory({
    api: scmIntegrationsApiRef,
    deps: { configApi: configApiRef },
    factory: ({ configApi }) => ScmIntegrationsApi.fromConfig(configApi),
  }),
  createApiFactory({
    api: scmAuthApiRef,
    deps: {
      github: githubAuthApiRef,
      gitlab: gitlabAuthApiRef,
      azure: microsoftAuthApiRef,
      bitbucket: bitbucketAuthApiRef,
      configApi: configApiRef,
    },
    factory: ({ github, gitlab, azure, bitbucket, configApi }) => {
      const providers = [
        { key: 'github', ref: github, factory: ScmAuth.forGithub },
        { key: 'gitlab', ref: gitlab, factory: ScmAuth.forGitlab },
        { key: 'azure', ref: azure, factory: ScmAuth.forAzure },
        { key: 'bitbucket', ref: bitbucket, factory: ScmAuth.forBitbucket },
      ];

      const scmAuths = providers.flatMap(({ key, ref, factory }) => {
        const configs = configApi.getOptionalConfigArray(`integrations.${key}`);
        if (!configs?.length) {
          return [factory(ref)];
        }
        return configs.map(c => factory(ref, { host: c.getString('host') }));
      });

      return ScmAuth.merge(...scmAuths);
    },
  }),
  createApiFactory({
    api: learningPathApiRef,
    deps: {
      discoveryApi: discoveryApiRef,
      configApi: configApiRef,
      identityApi: identityApiRef,
    },
    factory: ({ discoveryApi, configApi, identityApi }) =>
      new LearningPathApiClient({ discoveryApi, configApi, identityApi }),
  }),
  // OIDC
  createApiFactory({
    api: oidcAuthApiRef,
    deps: {
      discoveryApi: discoveryApiRef,
      oauthRequestApi: oauthRequestApiRef,
      configApi: configApiRef,
    },
    factory: ({ discoveryApi, oauthRequestApi, configApi }) =>
      OAuth2.create({
        configApi,
        discoveryApi,
        // TODO: Check if 1.32 fixes this type error
        oauthRequestApi: oauthRequestApi as any,
        provider: {
          id: 'oidc',
          title: 'OIDC',
          icon: () => null,
        },
        environment: configApi.getOptionalString('auth.environment'),
      }),
  }),
  // Auth0
  createApiFactory({
    api: auth0AuthApiRef,
    deps: {
      discoveryApi: discoveryApiRef,
      oauthRequestApi: oauthRequestApiRef,
      configApi: configApiRef,
    },
    factory: ({ discoveryApi, oauthRequestApi, configApi }) =>
      OAuth2.create({
        discoveryApi,
        // TODO: Check if 1.32 fixes this type error
        oauthRequestApi: oauthRequestApi as any,
        provider: {
          id: 'auth0',
          title: 'Auth0',
          icon: () => null,
        },
        defaultScopes: ['openid', 'email', 'profile'],
        environment: configApi.getOptionalString('auth.environment'),
      }),
  }),
  // SAML
  createApiFactory({
    api: samlAuthApiRef,
    deps: {
      discoveryApi: discoveryApiRef,
      oauthRequestApi: oauthRequestApiRef,
      configApi: configApiRef,
    },
    factory: ({ discoveryApi, oauthRequestApi, configApi }) =>
      OAuth2.create({
        discoveryApi,
        // TODO: Check if 1.32 fixes this type error
        oauthRequestApi: oauthRequestApi as any,
        provider: {
          id: 'saml',
          title: 'SAML',
          icon: () => null,
        },
        environment: configApi.getOptionalString('auth.environment'),
      }),
  }),
];
