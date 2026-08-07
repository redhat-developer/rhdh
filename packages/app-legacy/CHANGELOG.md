# app

## 1.0.1

### Patch Changes

- 69c6c7d: fix `app-config.example.yaml`

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

- 8356de2: The [Lighthouse plugin](https://github.com/backstage/backstage/tree/master/plugins/lighthouse) has been added with the `LighthouseCard` in the Lighthouse Tab in the Sidebar panel, the `EntityLighthouseContent` in the Entity Page Lighthouse Tab, and the `EntityLastLighthouseAuditCard` in the Entity Page Overview Tab.

  These changes are **required** in `app-config.yaml` if you want to add the Lighthouse plugin. Please read the [README](https://github.com/redhat-developer/rhdh/blob/main/README.md) and [Getting Started](https://github.com/redhat-developer/rhdh/blob/main/showcase-docs/getting-started.md) for more details.

  Please note that the Lighthouse plugin is a frontend for the [Lighthouse Audit Service](https://github.com/spotify/lighthouse-audit-service/tree/master) and requires it to be running.

  ```yaml
  # app-config.yaml OR app-config.local.yaml
  lighthouse:
    baseUrl: ${LIGHTHOUSE_BASEURL}
  ```

  - To integrate the Lighthouse plugin into the catalog so that the Lighthouse audit info for a component can be displayed in that component's entity page, it is necessary to annotate the entity as shown below.
  - Please Note that it is **essential** to include the `https://` or `http::/` in front of the link for this plugin to function correctly.
  - Also please note that ending the website url with a `/` will cause it to be treated as a separate link compared to the same url without the `/`.
    - i.e. `https://backstage.io/` and `https://backstage.io` are not considered the same, therefore audits for each will be grouped separately.

  ```yaml
  apiVersion: backstage.io/v1alpha1
  kind: Component
  metadata:
    # ...
    annotations:
      lighthouse.com/website-url: # A single website url e.g. https://backstage.io/
  ```

- 3fa3145: The [Dynatrace](https://github.com/backstage/backstage/tree/master/plugins/dynatrace) has been added with the `<DynatraceTab />` in the Entity Page Monitoring tab.

  Since Dynatrace requires a proxy endpoint, these changes are **required** to `app-config.yaml` if you want to add the Dynatrace plugin. Please read the [README](../README.md) and [Getting Started](../showcase-docs/getting-started.md) for more details.

  ```diff
  proxy:
    # Other proxy configurations...

  +   '/dynatrace':
  +   target: ${DYNATRACE_API_URL}
  +   headers:
  +     Authorization: 'Api-Token ${DYNATRACE_ACCESS_TOKEN}'
  ```

- 5a02b31: Support for Bitbucket has been added.

  To enable Bitbucket support, please provide the host for your bitbucket server instance, and the relevant credentials to that instance. Please read [Getting Started](../showcase-docs/getting-started.md#running-locally-with-the-optional-plugins) for more details.

- 5c43a31: The [PagerDuty](https://github.com/backstage/backstage/tree/master/plugins/pagerduty) has been added with the `<EntityPagerDutyCard />` in the Entity Page Overview tab.

  Since PagerDuty requires a proxy endpoint, these changes are **required** to `app-config.yaml` if you want to add the PagerDuty plugin. Please read the [README](../README.md) and [Getting Started](../showcase-docs/getting-started.md) for more details.

  ```yaml
  proxy:
    # Other proxy configurations...

    '/pagerduty':
      target: https://api.pagerduty.com
      headers:
        Authorization: Token token=${PAGERDUTY_TOKEN}
  ```

- d947683: The [Datadog](https://github.com/RoadieHQ/roadie-backstage-plugins/tree/main/plugins/frontend/backstage-plugin-datadog) has been added with the `<EntityDatadogContent />` in the Entity Page monitoring tab.

## 0.1.0

### Minor Changes

- 526b40d: The [Jira plugin](https://github.com/RoadieHQ/roadie-backstage-plugins/tree/main/plugins/frontend/backstage-plugin-jira) has been added with the `EntityJiraOverviewCard` in the Entity Page issues tab.

  These changes are **required** to `app-config.yaml` if you want to add the Jira plugin. Please read the [README](https://github.com/redhat-developer/rhdh/blob/main/README.md) and [Getting Started](https://github.com/redhat-developer/rhdh/blob/main/showcase-docs/getting-started.md) for more details.

  ```diff
   backend:
     # Other backend configurations...

     csp:
       connect-src: ["'self'", 'http:', 'https:']
  +    img-src:
  +      - "'self'"
  +      - 'data:'
  +      - ${JIRA_URL}
     cors:
       origin: http://localhost:3000
       methods: [GET, HEAD, PATCH, POST, PUT, DELETE]
  ```

  ```diff
   proxy:
     # Other proxy configurations...

  +  '/jira/api':
  +    target: ${JIRA_URL}
  +    headers:
  +      Authorization: ${JIRA_TOKEN}
  +      Accept: 'application/json'
  +      Content-Type: 'application/json'
  +      X-Atlassian-Token: 'no-check'
  +      User-Agent: ${JIRA_USER_AGENT}
  +
   techdocs:
     builder: ${TECHDOCS_BUILDER_TYPE}
     generator:
  ```

- cb6c541: The [Jfrog Artifactory plugin](https://github.com/backstage/community-plugins/tree/main/workspaces/jfrog-artifactory/plugins/jfrog-artifactory) has been added with the `JfrogArtifactoryPage` in the Entity Page image registry tab.

  These changes are **required** to `app-config.yaml` if you want to add the JFrog Artifactory plugin. Please read the [README](https://github.com/redhat-developer/rhdh/blob/main/README.md) and [Getting Started](https://github.com/redhat-developer/rhdh/blob/main/showcase-docs/getting-started.md) for more details.

  ```diff
   proxy:
     # Other proxy configurations...

  +  '/jfrog-artifactory/api':
  +    target: ${ARTIFACTORY_URL}
  +    headers:
  +      Authorization: Bearer ${ARTIFACTORY_TOKEN}
  +    secure: ${ARTIFACTORY_SECURE}
  +
   techdocs:
     builder: ${TECHDOCS_BUILDER_TYPE}
     generator:
  ```
