# Auth Providers within RHDH

Currently we incorporate many of the Authentication providers available within Backstage. The Showcase supports the following providers:

| Auth Provider        | Auth Provider ID  |
| -------------------- | ----------------- |
| Auth0                | `auth0`           |
| Atlassian            | `atlassian`       |
| Azure                | `microsoft`       |
| Azure Easy Auth      | `azure-easyauth`  |
| Bitbucket            | `bitbucket`       |
| Bitbucket Server     | `bitbucketServer` |
| Cloudflare Access    | `cfaccess`        |
| GitHub               | `github`          |
| GitLab               | `gitlab`          |
| Google               | `google`          |
| Google IAP           | `gcp-iap`         |
| OIDC                 | `oidc`            |
| Okta                 | `okta`            |
| OAuth 2 Custom Proxy | `oauth2Proxy`     |
| OneLogin             | `onelogin`        |
| SAML                 | `saml`            |

## Enabling Authentication in Showcase

### GitHub

- Add the GitHub Authentication provider details as outlined below.

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

### GitLab

- Add the GitLab Authentication provider details as outlined below.

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
  ```

For more information on setting up the GitLab auth provider, consult the [Backstage documentation](https://backstage.io/docs/auth/gitlab/provider).

### OAuth2 Proxy

The OAuth2 Proxy Authentication provider will require an OAuth2 Proxy server. You can consult the <!-- markdown-link-check-disable -->[official documentation](https://oauth2-proxy.github.io/oauth2-proxy/)<!-- markdown-link-check-enable --> for OAuth2 Proxy, as well as our available [blog post](https://janus-idp.io/blog/2023/01/17/enabling-keycloak-authentication-in-backstage) on the topic.

- Add the OAuth2 Proxy Authentication provider details as outlined below.

  ```yaml
  auth:
  environment: development
  providers:
    oauth2Proxy: {}
  ```

For more information on setting up the OAuth2 Proxy auth provider, consult the [Backstage documentation](https://backstage.io/docs/auth/oauth2-proxy/provider).

### OIDC

- Add the OIDC Authentication provider details as outlined below.

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
          prompt: ${AUTH_OIDC_PROMPT} # recommended to use auto
          ## uncomment for additional configuration options
          # callbackUrl: ${AUTH_OIDC_CALLBACK_URL}
          # tokenEndpointAuthMethod: ${AUTH_OIDC_TOKEN_ENDPOINT_METHOD}
          # tokenSignedResponseAlg: ${AUTH_OIDC_SIGNED_RESPONSE_ALG}
          # scope: ${AUTH_OIDC_SCOPE}
          ## Auth provider will try each resolver until it succeeds. Uncomment the resolvers you want to use to override the default resolver: `emailLocalPartMatchingUserEntityName`
          # signIn:
          #  resolvers:
          #    - resolver: preferredUsernameMatchingUserEntityName
          #    - resolver: emailMatchingUserEntityProfileEmail
          #    - resolver: emailLocalPartMatchingUserEntityName
          #    - resolver: oidcSubClaimMatchingKeycloakUserId
  ```

In an example using Keycloak for authentication with the OIDC provider, there are a few steps that need to be taken to get everything working:

1. Create a realm named keycloak.
2. Create the client backstage with Client authentication checked.
3. Set the Valid redirect URIs to `<BACKSTAGE_URL>/api/auth/oidc/handler/frame`. If running RHDH locally, it would look something like this: `http://localhost:7007/api/auth/oidc/handler/frame`.
4. Set the `metadataUrl` to the URL of your Keycloak instance and realm. It should look similar to this: `<KEYCLOAK_URL>/realms/keycloak`.
5. Set the `clientId` to `backstage`.
6. Obtain the client secret for the client backstage within Keycloak and set `clientSecret`.
7. Set the `prompt` to `auto`.
8. Finally, set `auth.session.secret` to `superSecretSecret`.

The default resolver provided by the `oidc` auth provider is the `emailLocalPartMatchingUserEntityName` resolver.

If you want to use a different resolver, add the resolver you want to use in the `auth.providers.oidc.[environment].signIn.resolvers` configuration as soon in the example above, and it will override the default resolver.

- For enhanced security, consider using the `oidcSubClaimMatchingKeycloakUserId` resolver which matches the user with the immutable `sub` parameter from OIDC to the Keycloak user ID.

For more information on setting up the OIDC auth provider, consult the [Backstage documentation](https://backstage.io/docs/auth/oidc#the-configuration).

### Sign In Page configuration value

After selecting the authentication provider you wish to use with your RHDH instance, ensure to add the `signInPage` configuration value to ensure that the frontend displays the appropriate authentication provider.

- Add the corresponding Authentication provider key as the value to `signInPage` in your `app-config`. Where `provider-id` matches the chosen provider from the table above.

  ```yaml
  signInPage: <provider-id>
  ```

### Enabling/Disabling the guest provider and login

The guest login is provided by a special authentication provider that must be explicitly enabled. This authentication provider should be used for development purposes only and is not intended for production, as it creates a default user that has user-level access to the Backstage instance.

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
          - resolver: preferredUsernameMatchingUserEntityName
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
### disableIdentityResolution configuration value

In scenarios where multiple authentication providers are used (e.g., Keycloak for primary sign-in and GitHub for plugin access), you can use this config to allow the auxiliary auth provider without the need to resolve or issue a user identity. By default, this option is set to false.

When enabled:
* The auxiliary auth provider can still be used for API access (e.g., GitHub plugins).
* RHDH will not try to resolve the user signing in with an entity in the catalog. i.e. they can signin without the need to provision user/group entities for that IdP.
* No user identity is issued on sign-in.

Do not enable this setting on the primary auth provider you plan on using for sign-in and identity resolution/management (i.e. setting `signInPage` to a provider with this config enabled). When this misconfiguration is applied, you will see the following error:

`Login failed; caused by Error: The <providerId> provider is not configured to support sign-in.`

To enable this option:

```yaml
auth:
  providers:
    oidc:
      development:
        ...
        disableIdentityResolution: true
        # other provider configs ...
```

## External authentication providers

External authentication providers can be loaded using the dynamic plugins mechanism.  Typically this will require a backend plugin to provide the authentication provider API implementation and callback handling, and a frontend plugin to connect this API to important parts of the UI in the form of a [custom SignInPage](dynamic-plugins/frontend-plugin-wiring.md#use-a-custom-signinpage-component) and [provider settings](dynamic-plugins/frontend-plugin-wiring.md#adding-custom-authentication-provider-settings) entries for the user settings page.  

The existing Developer Hub authentication module will need to be disabled by setting an [environment variable](dynamic-plugins/override-core-services.md#overriding-the-provided-authentication-module), `ENABLE_AUTH_PROVIDER_MODULE_OVERRIDE` to `true` for the Developer Hub backend.

Some examples of composing dynamic plugins to provide an authentication solution are available in the [dynamic plugins examples](dynamic-plugins/examples.md).