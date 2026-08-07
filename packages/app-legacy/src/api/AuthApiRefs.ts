import {
  createApiRef,
  type ApiRef,
  type BackstageIdentityApi,
  type OAuthApi,
  type OpenIdConnectApi,
  type ProfileInfoApi,
  type SessionApi,
} from '@backstage/core-plugin-api';

type CustomAuthApiRefType = OAuthApi &
  OpenIdConnectApi &
  ProfileInfoApi &
  BackstageIdentityApi &
  SessionApi;

export const oidcAuthApiRef: ApiRef<CustomAuthApiRefType> = createApiRef({
  id: 'internal.auth.oidc',
});

export const auth0AuthApiRef: ApiRef<CustomAuthApiRefType> = createApiRef({
  id: 'internal.auth.auth0',
});

export const samlAuthApiRef: ApiRef<CustomAuthApiRefType> = createApiRef({
  id: 'internal.auth.saml',
});
