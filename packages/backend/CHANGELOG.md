# backend

## 1.0.1

### Patch Changes

- 69c6c7d: fix `app-config.example.yaml`
- Updated dependencies [69c6c7d]
  - app@1.0.1

## 1.0.0

### Major Changes

- f26ad0d: Update the proxy object to include the endpoint property in `app-config.yaml`

  e.g.

  ```yaml
  proxy:
    endpoints:
      # Plugin: Quay
      '/quay/api':
        target: https://quay.io/
        headers:
          X-Requested-With: 'XMLHttpRequest'
          # Uncomment the following line to access a private Quay Repository using a token
          # Authorization: 'Bearer <YOUR TOKEN>'
        changeOrigin: true
        secure: true
  ```

### Minor Changes

- 78f4420: Adds Authentication to the showcase app. Adds a sign on page that will either use the GitHub and Guest identity providers or the Oauth2Proxy identity provider based on an environment variable set within the app-config.

  GitHub and guest will be used whenever the environment variable is set to development

  Oauth2Proxy will be used whenever the environment variable is set to production
  - note: the GitHub section will also need to be updated to ensure that the GitHub plugins work properly

  To enable GitHub and guest Sign in pages, add the below to the app-config

  ```yaml
  auth:
    environment: development
    providers:
      github:
        development:
          clientId: ${GITHUB_APP_CLIENT_ID}
          clientSecret: ${GITHUB_APP_CLIENT_SECRET}
  ```

  To enable Keycloak Sign in, add the below to the app-config

  ```yaml
  auth:
    environment: production
    providers:
      github:
        production:
          clientId: ${GITHUB_APP_CLIENT_ID}
          clientSecret: ${GITHUB_APP_CLIENT_SECRET}
      oauth2Proxy: {}
  ```

- 9cb37db: Adds a default allow all permission policy to the showcase app. Enabling the permission plugin requires permission.enabled to be set to true in the app-config. Also there is a requirement to set service to service auth which includes an auth key within the app-config.

  Documentation for setting an auth key can be found under Service to [Service Auth](https://backstage.io/docs/auth/service-to-service-auth#setup)

  ```diff
  backend:
  + auth:
  +   keys:
  +     - secret: ${BACKEND_AUTH_SECRET}
  ...

  + permission:
  +   enabled: ${PERMISSION_ENABLED}
  ...

    enabled:
  +   permission: ${PERMISSION_ENABLED}
  ```

- 83003f0: Added Gitlab Discovery via the GitlabDiscoveryEntityProvider. For more information on how to configure the showcase to enable Gitlab Discovery refer to the `getting-started` [documentation](https://github.com/redhat-developer/rhdh/blob/main/showcase-docs/getting-started.md#running-locally-with-the-optional-plugins)

### Patch Changes

- Updated dependencies [f26ad0d]
- Updated dependencies [78f4420]
- Updated dependencies [8356de2]
- Updated dependencies [3fa3145]
- Updated dependencies [5a02b31]
- Updated dependencies [5c43a31]
- Updated dependencies [d947683]
  - app@1.0.0
