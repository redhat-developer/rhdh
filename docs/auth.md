# Auth Providers within RHDH

Developer Hub authentication providers are loaded as [dynamic plugins](dynamic-plugins/installing-plugins.md) published from [rhdh-plugin-export-overlays](https://github.com/redhat-developer/rhdh-plugin-export-overlays).

| Auth Provider | Auth Provider ID | Overlay package | Typical catalog pairing |
| ------------- | ---------------- | --------------- | ----------------------- |
| Guest | `guest` | [guest-provider](https://github.com/orgs/redhat-developer/packages/container/package/rhdh-plugin-export-overlays/backstage-plugin-auth-backend-module-guest-provider) | — |
| GitHub | `github` | [github-provider](https://github.com/orgs/redhat-developer/packages/container/package/rhdh-plugin-export-overlays/backstage-plugin-auth-backend-module-github-provider) | `catalog-backend-module-github-org` (optional) |
| GitLab | `gitlab` | [gitlab-provider](https://github.com/orgs/redhat-developer/packages/container/package/rhdh-plugin-export-overlays/backstage-plugin-auth-backend-module-gitlab-provider) | `catalog-backend-module-gitlab-org` |
| Microsoft / Azure | `microsoft` | [microsoft-provider](https://github.com/orgs/redhat-developer/packages/container/package/rhdh-plugin-export-overlays/backstage-plugin-auth-backend-module-microsoft-provider) | `catalog-backend-module-msgraph` |
| OIDC (generic IdP) | `oidc` | [oidc-provider](https://github.com/orgs/redhat-developer/packages/container/package/rhdh-plugin-export-overlays/backstage-plugin-auth-backend-module-oidc-provider) | depends on the IdP |
| Keycloak | `keycloak` | [keycloak-provider](https://github.com/orgs/redhat-developer/packages/container/package/rhdh-plugin-export-overlays/backstage-community-plugin-auth-backend-module-keycloak-provider) | `catalog-backend-module-keycloak` |
| PingFederate | `pingfederate` | [pingfederate-provider](https://github.com/orgs/redhat-developer/packages/container/package/rhdh-plugin-export-overlays/backstage-community-plugin-auth-backend-module-pingfederate-provider) | LDAP catalog module as needed |

Enable the matching overlay package from the plugin catalog before adding that provider under `auth.providers`. Configuring `auth.providers.<id>` without the plugin does not register the provider.

**Breaking change:** Keycloak and Ping Identity are no longer configured under `oidc`. Use `auth.providers.keycloak` / `signInPage: keycloak` and `auth.providers.pingfederate` / `signInPage: pingfederate`, and update IdP redirect URIs to `/api/auth/keycloak/handler/frame` and `/api/auth/pingfederate/handler/frame`.

## Enabling Authentication in Showcase

### GitHub

Enable the [GitHub auth backend overlay package](https://github.com/orgs/redhat-developer/packages/container/package/rhdh-plugin-export-overlays/backstage-plugin-auth-backend-module-github-provider) (`@backstage/plugin-auth-backend-module-github-provider`), then add the provider details as outlined below.

```yaml
auth:
  environment: development
  providers:
    github:
      development:
        clientId: ${AUTH_GITHUB_CLIENT_ID}
        clientSecret: ${AUTH_GITHUB_CLIENT_SECRET}
        ## uncomment if using GitHub Enterprise
        # enterpriseInstanceUrl: ${AUTH_GITHUB_ENTERPRISE_INSTANCE_URL}
        ## uncomment if using a custom callback url
        # callbackUrl: ${AUTH_GITHUB_CALLBACK_URL}
```

For more information on setting up the GitHub auth provider, consult the [Backstage documentation](https://backstage.io/docs/auth/github/provider).

When GitHub is only used for SCM / plugin API access (another provider handles sign-in), omit `signIn.resolvers` so GitHub does not issue a Backstage identity.

### GitLab

Enable the [GitLab auth backend overlay package](https://github.com/orgs/redhat-developer/packages/container/package/rhdh-plugin-export-overlays/backstage-plugin-auth-backend-module-gitlab-provider) (`@backstage/plugin-auth-backend-module-gitlab-provider`), then add the provider details as outlined below. Pair it with the GitLab org catalog module when you need user and group ingestion.

```yaml
auth:
  environment: development
  providers:
    gitlab:
      development:
        clientId: ${AUTH_GITLAB_CLIENT_ID}
        clientSecret: ${AUTH_GITLAB_CLIENT_SECRET}
        ## uncomment if using self-hosted GitLab
        # audience: https://gitlab.company.com
        ## uncomment if using a custom redirect URI
        # callbackUrl: https://${BASE_URL}/api/auth/gitlab/handler/frame
        signIn:
          resolvers:
            - resolver: emailMatchingUserEntityProfileEmail
```

For more information on setting up the GitLab auth provider, consult the [Backstage documentation](https://backstage.io/docs/auth/gitlab/provider).

### Microsoft

Enable the [Microsoft auth backend overlay package](https://github.com/orgs/redhat-developer/packages/container/package/rhdh-plugin-export-overlays/backstage-plugin-auth-backend-module-microsoft-provider) (`@backstage/plugin-auth-backend-module-microsoft-provider`), then add the provider details. Pair it with the Microsoft Graph catalog module when you need user and group ingestion.

```yaml
auth:
  environment: development
  providers:
    microsoft:
      development:
        clientId: ${AUTH_MICROSOFT_CLIENT_ID}
        clientSecret: ${AUTH_MICROSOFT_CLIENT_SECRET}
        tenantId: ${AUTH_MICROSOFT_TENANT_ID}
        signIn:
          resolvers:
            - resolver: emailMatchingUserEntityProfileEmail
```

For more information, consult the [Backstage documentation](https://backstage.io/docs/auth/microsoft/provider).

### OIDC (generic identity providers)

Use the stock [OIDC auth backend overlay package](https://github.com/orgs/redhat-developer/packages/container/package/rhdh-plugin-export-overlays/backstage-plugin-auth-backend-module-oidc-provider) (`@backstage/plugin-auth-backend-module-oidc-provider`) for generic OpenID Connect IdPs. Enable the plugin, then add the provider details as outlined below.

The published OIDC module provides `emailMatchingUserEntityProfileEmail` and `emailLocalPartMatchingUserEntityName`. Do not use Keycloak- or Ping-specific resolvers on `oidc`.

```yaml
auth:
  environment: development
  # Providing an auth.session.secret will enable session support in the auth-backend
  session:
    secret: ${SESSION_SECRET}
  providers:
    oidc:
      development:
        metadataUrl: ${AUTH_OIDC_METADATA_URL}
        clientId: ${AUTH_OIDC_CLIENT_ID}
        clientSecret: ${AUTH_OIDC_CLIENT_SECRET}
        prompt: auto # recommended
        ## uncomment for additional configuration options
        # callbackUrl: ${AUTH_OIDC_CALLBACK_URL}
        # tokenEndpointAuthMethod: ${AUTH_OIDC_TOKEN_ENDPOINT_METHOD}
        # tokenSignedResponseAlg: ${AUTH_OIDC_SIGNED_RESPONSE_ALG}
        # scope: ${AUTH_OIDC_SCOPE}
        signIn:
          resolvers:
            - resolver: emailMatchingUserEntityProfileEmail
            # - resolver: emailLocalPartMatchingUserEntityName
```

Set the IdP Valid redirect URIs to `<BACKSTAGE_URL>/api/auth/oidc/handler/frame`.

The auth provider tries each configured resolver until one succeeds. If you omit `signIn.resolvers`, the provider can still be used for API access without issuing a Backstage identity.

For more information on setting up the OIDC auth provider, consult the [Backstage documentation](https://backstage.io/docs/auth/oidc#the-configuration).

### Keycloak

Enable the [Keycloak auth backend overlay package](https://github.com/orgs/redhat-developer/packages/container/package/rhdh-plugin-export-overlays/backstage-community-plugin-auth-backend-module-keycloak-provider) (`@backstage-community/plugin-auth-backend-module-keycloak-provider`) and pair it with the Keycloak catalog module when you need user and group ingestion.

```yaml
auth:
  environment: development
  session:
    secret: ${SESSION_SECRET}
  providers:
    keycloak:
      development:
        baseUrl: ${KEYCLOAK_BASE_URL}
        realm: ${KEYCLOAK_REALM}
        clientId: ${KEYCLOAK_CLIENT_ID}
        clientSecret: ${KEYCLOAK_CLIENT_SECRET}
        prompt: auto
        signIn:
          resolvers:
            - resolver: preferredUsernameMatchingUserEntityName
            # - resolver: oidcSubClaimMatchingKeycloakUserId
            # - resolver: emailMatchingUserEntityProfileEmail
```

1. Create a Keycloak client with Client authentication enabled.
2. Set Valid redirect URIs to `<BACKSTAGE_URL>/api/auth/keycloak/handler/frame`.
3. Set `signInPage: keycloak`.

`preferredUsernameMatchingUserEntityName` and `oidcSubClaimMatchingKeycloakUserId` are provided by the Keycloak community module, not by stock OIDC.

### PingFederate

Enable the [PingFederate auth backend overlay package](https://github.com/orgs/redhat-developer/packages/container/package/rhdh-plugin-export-overlays/backstage-community-plugin-auth-backend-module-pingfederate-provider) (`@backstage-community/plugin-auth-backend-module-pingfederate-provider`). See [Ping Identity authentication provider setup](./ping-identity-oidc-setup.md) for application and redirect URI details.

```yaml
auth:
  providers:
    pingfederate:
      development:
        metadataUrl: https://auth.pingone.ca/${PING_IDENTITY_ENV_ID}/as/.well-known/openid-configuration
        clientId: ${PING_IDENTITY_CLIENT_ID}
        clientSecret: ${PING_IDENTITY_CLIENT_SECRET}
        prompt: auto
        signIn:
          resolvers:
            - resolver: subClaimMatchingPingIdentityUserId
```

Set `signInPage: pingfederate` and Valid redirect URIs to `<BACKSTAGE_URL>/api/auth/pingfederate/handler/frame`.

### Sign In Page configuration value

After selecting the authentication provider(s) you wish to use with your RHDH instance, add the `signInPage` configuration value to ensure that the frontend displays the appropriate authentication provider(s). The provider ID must match a loaded backend provider (`github`, `gitlab`, `oidc`, `keycloak`, `pingfederate`, and so on).

The default frontend SignIn page understands the built-in provider IDs (including `oidc`). `keycloak` and `pingfederate` require the `app-auth` frontend plugin so the UI can present those providers.

#### Single provider

- Add the corresponding Authentication provider key as the value to `signInPage` in your `app-config`. Where `provider-id` matches the chosen provider from the table above.

  ```yaml
  signInPage: <provider-id>
  ```

#### Multiple providers

- To allow users to authenticate with multiple auth providers, you can specify a list of provider IDs:

  ```yaml
  signInPage:
    - github
    - microsoft
    - oidc
  ```

  This will display a sign-in page with buttons for each of the specified authentication providers, allowing users to choose their preferred method of authentication.

  **Note:** If any of the specified providers is a proxied provider (e.g., `oauth2Proxy`), only the first proxied provider will be used and a proxied sign-in page will be displayed instead.

### Enabling/Disabling the guest provider and login

The guest login is provided by a dedicated authentication provider dynamic plugin that must be installed and enabled in config. This authentication provider should be used for development purposes only and is not intended for production, as it creates a default user that has user-level access to the Backstage instance.

- To enable the guest provider for local development:

  ```yaml
  auth:
    providers:
      guest: {}
  ```

  This will sign you in as `user:development/guest`

- To customize the `userEntity` the auth provider signs you in with:

  ```yaml
  auth:
    providers:
      guest:
        userEntityRef: user:custom-namespace/custom-name
  ```

- To customize the ownership of the `userEntity` the auth provider signs you in with:

  ```yaml
  auth:
    providers:
      guest:
        ownershipEntityRefs: ['user:custom/user', 'user:custom2/user2']
  ```

- To enable the guest provider when running the container:

  ```yaml
  auth:
    providers:
      guest:
        dangerouslyAllowOutsideDevelopment: true
  ```

- To disable the guest login set `auth.environment` to `production`.

### dangerouslyAllowSignInWithoutUserInCatalog configuration value

This option allows users to sign in even if their profile has not been ingested into the catalog. By default, this option is set to false. Enabling this option is dangerous as it may allow unauthorized users to gain access.

To enable this option:

```yaml
auth:
  providers:
    oidc:
      development:
        ...
        signIn:
          resolvers:
            - resolver: emailMatchingUserEntityProfileEmail
              dangerouslyAllowSignInWithoutUserInCatalog: true
  # provider configs ...
```

### includeTransitiveGroupOwnership configuration value

This option allows users to add transitive parent groups into the resolved user group membership during the authentication process. i.e., the parent group of the user's direct group will be included in the user ownership entities. By default, this option is set to false.

For instance, with this group hierarchy:

```text
group_admin
  └── group_developers
        └── user_alice
```

- If `includeTransitiveGroupOwnership: false`, `user_alice` is only a member of `group_developers`.
- If `includeTransitiveGroupOwnership: true`, `user_alice` is a member of `group_developers` AND `group_admin`.

To enable this option:

```yaml
includeTransitiveGroupOwnership: true
auth:
  providers:
    # provider configs ...
```

### Auxiliary providers (no sign-in identity)

When multiple authentication providers are used (for example Keycloak for primary sign-in and GitHub for plugin access), omit `signIn.resolvers` on the auxiliary provider. The provider can still be used for API access without resolving a catalog user or issuing a Backstage identity.

Do not omit `signIn.resolvers` on the primary auth provider you plan on using for sign-in (the provider listed in `signInPage`). When this misconfiguration is applied, you will see:

`Login failed; caused by Error: The <providerId> provider is not configured to support sign-in.`

```yaml
auth:
  providers:
    github:
      development:
        clientId: ${AUTH_GITHUB_CLIENT_ID}
        clientSecret: ${AUTH_GITHUB_CLIENT_SECRET}
        # no signIn.resolvers — GitHub is used for SCM tokens only
```

## Guest and GitHub providers

Guest and GitHub providers are installed through dynamic plugins like the other auth providers. Enable the corresponding overlay packages and configure `auth.providers.<provider-id>`.

`ENABLE_AUTH_PROVIDER_MODULE_OVERRIDE` is deprecated and ignored.

Custom frontend sign-in UI is still loaded through a [custom SignInPage](dynamic-plugins/frontend-plugin-wiring.md#use-a-custom-signinpage-component) and [provider settings](dynamic-plugins/frontend-plugin-wiring.md#adding-custom-authentication-provider-settings).
