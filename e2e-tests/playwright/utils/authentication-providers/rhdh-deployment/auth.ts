import { expect } from "@playwright/test";
import * as yaml from "yaml";

import { setPluginEnabled } from "../../dynamic-plugins-profile";
import { RHDHDeploymentState } from "./types";

export interface AuthConfigActions {
  setDynamicPluginEnabled(pluginName: string, enabled: boolean): void;
  setAppConfigProperty(path: string, value: unknown): void;
}

const OIDC_CALLBACK_URL = "${BASE_URL:-http://localhost:7007}/api/auth/oidc/handler/frame";

export function enableOIDCLoginWithIngestion(actions: AuthConfigActions): void {
  console.log("Enabling OIDC login with ingestion...");
  expect(process.env.RHBK_BASE_URL).toBeDefined();
  expect(process.env.RHBK_REALM).toBeDefined();
  expect(process.env.RHBK_CLIENT_ID).toBeDefined();
  expect(process.env.RHBK_CLIENT_SECRET).toBeDefined();

  actions.setDynamicPluginEnabled(
    "./dynamic-plugins/dist/backstage-community-plugin-catalog-backend-module-keycloak-dynamic",
    true,
  );
  actions.setAppConfigProperty("catalog.providers", {
    keycloakOrg: {
      default: {
        baseUrl: "${RHBK_BASE_URL}",
        loginRealm: "${RHBK_REALM}",
        realm: "${RHBK_REALM}",
        clientId: "${RHBK_CLIENT_ID}",
        clientSecret: "${RHBK_CLIENT_SECRET}",
        schedule: {
          frequency: { minutes: 1 },
          timeout: { minutes: 1 },
        },
      },
    },
  });

  actions.setAppConfigProperty("auth.providers.oidc", {
    production: {
      metadataUrl: "${RHBK_BASE_URL}/realms/${RHBK_REALM}",
      clientId: "${RHBK_CLIENT_ID}",
      clientSecret: "${RHBK_CLIENT_SECRET}",
      prompt: "auto",
      callbackUrl: OIDC_CALLBACK_URL,
    },
  });
  actions.setAppConfigProperty("auth.environment", "production");
  actions.setAppConfigProperty("signInPage", "oidc");
}

export function enablePingFederateOIDCLogin(actions: AuthConfigActions): void {
  console.log("Enabling PingFederate OIDC login...");
  expect(process.env.PINGFEDERATE_BASE_URL).toBeDefined();
  expect(process.env.PINGFEDERATE_CLIENT_ID).toBeDefined();
  expect(process.env.PINGFEDERATE_CLIENT_SECRET).toBeDefined();

  actions.setAppConfigProperty("auth.providers.oidc", {
    production: {
      metadataUrl: "${PINGFEDERATE_BASE_URL}/.well-known/openid-configuration",
      clientId: "${PINGFEDERATE_CLIENT_ID}",
      clientSecret: "${PINGFEDERATE_CLIENT_SECRET}",
      prompt: "auto",
      callbackUrl: OIDC_CALLBACK_URL,
    },
  });
  actions.setAppConfigProperty("auth.environment", "production");
  actions.setAppConfigProperty("signInPage", "oidc");
}

export function enableLDAPLoginWithIngestion(actions: AuthConfigActions): void {
  console.log("Enabling LDAP login with ingestion...");
  expect(process.env.RHBK_BASE_URL).toBeDefined();
  expect(process.env.RHBK_LDAP_REALM).toBeDefined();
  expect(process.env.RHBK_LDAP_CLIENT_ID).toBeDefined();
  expect(process.env.RHBK_LDAP_CLIENT_SECRET).toBeDefined();

  actions.setDynamicPluginEnabled(
    "./dynamic-plugins/dist/backstage-plugin-catalog-backend-module-ldap-dynamic",
    true,
  );
  actions.setAppConfigProperty("catalog.providers", {
    ldapOrg: {
      default: {
        target: "${LDAP_TARGET_URL}",
        bind: {
          dn: "${LDAP_BIND_DN}",
          secret: "${LDAP_BIND_SECRET}",
        },
        users: [
          {
            dn: "${LDAP_USERS_DN}",
            options: {
              filter: "(uid=*)",
              scope: "sub",
            },
          },
        ],
        groups: [
          {
            dn: "${LDAP_GROUPS_DN}",
            options: {
              filter: "(&(objectClass=group)(groupType:1.2.840.113556.1.4.803:=2147483648))",
              scope: "sub",
            },
          },
        ],
        schedule: {
          frequency: "PT1M",
          timeout: "PT1M",
        },
      },
    },
  });

  actions.setAppConfigProperty("auth.providers.oidc", {
    production: {
      metadataUrl: "${RHBK_BASE_URL}/realms/${RHBK_LDAP_REALM}",
      clientId: "${RHBK_LDAP_CLIENT_ID}",
      clientSecret: "${RHBK_LDAP_CLIENT_SECRET}",
      prompt: "auto",
      callbackUrl: OIDC_CALLBACK_URL,
    },
  });
  actions.setAppConfigProperty("auth.environment", "production");
  actions.setAppConfigProperty("signInPage", "oidc");
}

export function enableMicrosoftLoginWithIngestion(actions: AuthConfigActions): void {
  console.log("Enabling Microsoft login with ingestion...");
  expect(process.env.AUTH_PROVIDERS_AZURE_CLIENT_ID).toBeDefined();
  expect(process.env.AUTH_PROVIDERS_AZURE_CLIENT_SECRET).toBeDefined();
  expect(process.env.AUTH_PROVIDERS_AZURE_TENANT_ID).toBeDefined();

  actions.setDynamicPluginEnabled(
    "./dynamic-plugins/dist/backstage-plugin-catalog-backend-module-msgraph-dynamic",
    true,
  );
  actions.setAppConfigProperty("catalog.providers", {
    microsoftGraphOrg: {
      default: {
        target: "https://graph.microsoft.com/v1.0",
        authority: "https://login.microsoftonline.com",
        tenantId: "${AUTH_PROVIDERS_AZURE_TENANT_ID}",
        clientId: "${AUTH_PROVIDERS_AZURE_CLIENT_ID}",
        clientSecret: "${AUTH_PROVIDERS_AZURE_CLIENT_SECRET}",
        user: {
          filter:
            "accountEnabled eq true and userType eq 'member' and startswith(displayName,'TEST')",
        },
        group: {
          filter:
            "securityEnabled eq true and mailEnabled eq false and startswith(displayName,'TEST_')\n",
        },
        schedule: {
          frequency: "PT1M",
          timeout: "PT1M",
        },
      },
    },
  });

  actions.setAppConfigProperty("auth.providers.microsoft", {
    production: {
      clientId: "${AUTH_PROVIDERS_AZURE_CLIENT_ID}",
      clientSecret: "${AUTH_PROVIDERS_AZURE_CLIENT_SECRET}",
      prompt: "auto",
      tenantId: "${AUTH_PROVIDERS_AZURE_TENANT_ID}",
      callbackUrl: "${BASE_URL:-http://localhost:7007}/api/auth/microsoft/handler/frame",
    },
  });
  actions.setAppConfigProperty("auth.environment", "production");
  actions.setAppConfigProperty("signInPage", "microsoft");
}

export function enableGithubLoginWithIngestion(
  actions: AuthConfigActions,
  isRunningLocal: boolean,
): void {
  console.log("Enabling Github login with ingestion...");
  expect(process.env.AUTH_PROVIDERS_GH_ORG_NAME).toBeDefined();
  expect(process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET).toBeDefined();
  expect(process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_ID).toBeDefined();
  expect(process.env.AUTH_PROVIDERS_GH_ORG_APP_ID).toBeDefined();
  expect(process.env.AUTH_PROVIDERS_GH_ORG1_PRIVATE_KEY).toBeDefined();
  expect(process.env.AUTH_PROVIDERS_GH_ORG_WEBHOOK_SECRET).toBeDefined();

  actions.setDynamicPluginEnabled(
    "./dynamic-plugins/dist/backstage-plugin-catalog-backend-module-github-org-dynamic",
    true,
  );

  const transformerPluginPath = isRunningLocal
    ? "./dynamic-plugins/dist/@internal/backstage-plugin-catalog-backend-module-github-org-transformer-dynamic"
    : "oci://quay.io/rh-ee-jhe/catalog-github-org-transformer:v0.3.0!internal-backstage-plugin-catalog-backend-module-github-org-transformer";

  actions.setDynamicPluginEnabled(transformerPluginPath, true);

  actions.setAppConfigProperty("catalog.providers", {
    githubOrg: [
      {
        id: "github",
        githubUrl: "https://github.com",
        orgs: ["${AUTH_PROVIDERS_GH_ORG_NAME}"],
        schedule: {
          initialDelay: { seconds: 0 },
          frequency: { minutes: 1 },
          timeout: { minutes: 1 },
        },
      },
    ],
  });

  actions.setAppConfigProperty("integrations", {
    github: [
      {
        host: "github.com",
        apps: [
          {
            appId: "${AUTH_PROVIDERS_GH_ORG_APP_ID}",
            clientId: "${AUTH_PROVIDERS_GH_ORG_CLIENT_ID}",
            clientSecret: "${AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET}",
            privateKey: "${AUTH_PROVIDERS_GH_ORG1_PRIVATE_KEY}",
            webhookSecret: "${AUTH_PROVIDERS_GH_ORG_WEBHOOK_SECRET}",
          },
        ],
      },
    ],
  });

  actions.setAppConfigProperty("auth.providers.github", {
    production: {
      clientId: "${AUTH_PROVIDERS_GH_ORG_CLIENT_ID}",
      clientSecret: "${AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET}",
      callbackUrl: "${BASE_URL:-http://localhost:7007}/api/auth/github/handler/frame",
    },
  });

  actions.setAppConfigProperty("auth.environment", "production");
  actions.setAppConfigProperty("signInPage", "github");
}

export function enableGitlabLoginWithIngestion(actions: AuthConfigActions): void {
  console.log("Enabling GitLab login with ingestion...");
  expect(process.env.AUTH_PROVIDERS_GITLAB_HOST).toBeDefined();
  expect(process.env.AUTH_PROVIDERS_GITLAB_TOKEN).toBeDefined();
  expect(process.env.AUTH_PROVIDERS_GITLAB_PARENT_ORG).toBeDefined();

  actions.setDynamicPluginEnabled(
    "./dynamic-plugins/dist/backstage-plugin-catalog-backend-module-gitlab-org-dynamic",
    true,
  );

  actions.setAppConfigProperty("catalog.providers", {
    gitlab: {
      default: {
        host: "${AUTH_PROVIDERS_GITLAB_HOST}",
        orgEnabled: true,
        group: "${AUTH_PROVIDERS_GITLAB_PARENT_ORG}",
        restrictUsersToGroup: true,
        includeUsersWithoutSeat: true,
        schedule: {
          initialDelay: { seconds: 0 },
          frequency: { minutes: 1 },
          timeout: { minutes: 1 },
        },
      },
    },
  });

  actions.setAppConfigProperty("integrations", {
    gitlab: [
      {
        host: "${AUTH_PROVIDERS_GITLAB_HOST}",
        token: "${AUTH_PROVIDERS_GITLAB_TOKEN}",
        apiBaseUrl: "https://${AUTH_PROVIDERS_GITLAB_HOST}/api/v4",
      },
    ],
  });

  actions.setAppConfigProperty("auth.providers.gitlab", {
    production: {
      audience: "https://${AUTH_PROVIDERS_GITLAB_HOST}",
      clientId: "${AUTH_PROVIDERS_GITLAB_CLIENT_ID}",
      clientSecret: "${AUTH_PROVIDERS_GITLAB_CLIENT_SECRET}",
      callbackUrl: "${BASE_URL:-http://localhost:7007}/api/auth/gitlab/handler/frame",
    },
  });

  actions.setAppConfigProperty("auth.environment", "production");
  actions.setAppConfigProperty("signInPage", "gitlab");
}

export function setOIDCResolver(
  actions: AuthConfigActions,
  resolver: string,
  dangerouslyAllowSignInWithoutUserInCatalog: boolean = false,
): void {
  actions.setAppConfigProperty("auth.providers.oidc.production.signIn.resolvers", [
    {
      resolver,
      dangerouslyAllowSignInWithoutUserInCatalog,
    },
  ]);
}

export function setMicrosoftResolver(
  actions: AuthConfigActions,
  resolver: string,
  dangerouslyAllowSignInWithoutUserInCatalog: boolean = false,
): void {
  actions.setAppConfigProperty("auth.providers.microsoft.production.signIn.resolvers", [
    {
      resolver,
      dangerouslyAllowSignInWithoutUserInCatalog,
    },
  ]);
}

export function setGithubResolver(
  actions: AuthConfigActions,
  resolver: string,
  dangerouslyAllowSignInWithoutUserInCatalog: boolean = false,
): void {
  actions.setAppConfigProperty("auth.providers.github.production.signIn.resolvers", [
    {
      resolver,
      dangerouslyAllowSignInWithoutUserInCatalog,
    },
  ]);
}

export function setGitlabResolver(
  actions: AuthConfigActions,
  resolver: string,
  dangerouslyAllowSignInWithoutUserInCatalog: boolean = false,
): void {
  actions.setAppConfigProperty("auth.providers.gitlab.production.signIn.resolvers", [
    {
      resolver,
      dangerouslyAllowSignInWithoutUserInCatalog,
    },
  ]);
}

export function setDynamicPluginEnabled(
  state: RHDHDeploymentState,
  pluginName: string,
  enabled: boolean,
): void {
  setPluginEnabled(state.dynamicPluginsConfig, pluginName, enabled);
  console.log(`Plugin ${pluginName} has been ${enabled ? "enabled" : "disabled"}.`);
}

export function printDynamicPluginsConfig(state: RHDHDeploymentState): void {
  console.log(yaml.stringify(state.dynamicPluginsConfig.plugins));
}
