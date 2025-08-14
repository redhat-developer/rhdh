# Authentication Providers tests

The authentication providers tests are currently running for the following providers:

- OIDC using RHBK
- Microsoft using oauth2 provider
- Github
<!--- - LDAP using Active Directory -->

For each providers the tests verify:

- the supported resolvers
- the users and group ingestion
- that nested groups are ingested correctly
- the session token duration can be configured

Since changing any setting in the authentication providers configuration require to restart RHDH, the tests are dynamically configuring, creating, updating, restarting and deleting the RHDH instances.

The main target for these tests suites is Openshift and our CI environment. If you want to use your cluster as target, make sure you are currently logged in to an Openshift cluster as admin and your kubeconfig is currently exported. The tests will create a client from it and start creating the necessary resources. These tests rely on the RHDH Operator, make sure you have it installed in your cluster before running the tests.

When adding new test cases, you can also run the tests locally against a local RHDH instance. To do that, you need to:

- Run `yarn install` in root and e2e-tests to install all dependencies
- Configure the dynamic plugins locally
- export `ISRUNNINGLOCAL=true` environment variable
  - Optionally add `ISRUNNINGLOCALDEBUG=true` to see local backend logs
- Export all the environment variables required by the configuration and tests
- run the tests locally with `npx playwright test --project showcase-auth-providers --workers 1

The following plugins are required to run these tests, make sure they are exported into the dynamic-plugins-root folder when running locally:

- backstage-community-plugin-catalog-backend-module-keycloak-dynamic
- backstage-plugin-catalog-backend-module-github-org-dynamic
- backstage-plugin-catalog-backend-module-msgraph-dynamic
- backstage-community-plugin-rbac
