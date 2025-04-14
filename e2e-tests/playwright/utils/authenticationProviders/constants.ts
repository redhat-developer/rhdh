import ClientRepresentation from "@keycloak/keycloak-admin-client/lib/defs/clientRepresentation";
import GroupRepresentation from "@keycloak/keycloak-admin-client/lib/defs/groupRepresentation";
import UserRepresentation from "@keycloak/keycloak-admin-client/lib/defs/userRepresentation";
import { Group, User } from "@microsoft/microsoft-graph-types";

// required by RHSSO
export const RHSSO76_ADMIN_USERNAME = process.env.RHSSO76_ADMIN_USERNAME;
export const RHSSO76_ADMIN_PASSWORD = process.env.RHSSO76_ADMIN_PASSWORD;
export const RHSSO76_DEFAULT_PASSWORD = process.env.RHSSO76_DEFAULT_PASSWORD;
export const RHSSO76_URL = process.env.RHSSO76_URL;
export const RHSSO76_CLIENT_SECRET = process.env.RHSSO76_CLIENT_SECRET;
export const RHSSO76_CLIENTID = process.env.RHSSO76_CLIENT_ID;
export const RHSSO76_METADATA_URL =
  "https://keycloak-rhsso.rhdh-pr-os-a9805650830b22c3aee243e51d79565d-0000.us-east.containers.appdomain.cloud/auth/realms/authProviders";

export const RHBK_ADMIN_USERNAME = process.env.RHBK_ADMIN_USERNAME;
export const RHBK_ADMIN_PASSWORD = process.env.RHBK_ADMIN_PASSWORD;
export const RHBK_DEFAULT_PASSWORD = process.env.RHBK_DEFAULT_PASSWORD;
export const RHBK_URL = process.env.RHBK_URL;
export const RHBK_CLIENT_SECRET = process.env.RHBK_CLIENT_SECRET;
export const RHBK_CLIENTID = process.env.RHBK_CLIENT_ID;
export const RHBK_METADATA_URL =
  "https://rhbk-rhbk.rhdh-pr-os-a9805650830b22c3aee243e51d79565d-0000.us-east.containers.appdomain.cloud/realms/authProviders";

export const AUTH_PROVIDERS_REALM_NAME = process.env.AUTH_PROVIDERS_REALM_NAME
  ? process.env.AUTH_PROVIDERS_REALM_NAME
  : "authProviders";

export const RHSSO76_GROUPS: { [key: string]: GroupRepresentation } = {
  group_1: {
    name: "rhsso_group_1",
  },
  group_2: {
    name: "rhsso_group_2",
  },
  group_3: {
    name: "rhsso_group_3",
  },
  group_4: {
    name: "rhsso_group_4",
  },
  location_admin: {
    name: "rhsso_group_location_reader",
  },
};
export const RHSSO76_NESTED_GROUP: GroupRepresentation = {
  name: "rhsso_group_nested",
};
export const RHSSO76_USERS: { [key: string]: UserRepresentation } = {
  admin: {
    username: "rhsso_admin",
    email: "rhsso_admin@rhdh.test",
    firstName: "Admin",
    lastName: "RHSSO",
    emailVerified: true,
    enabled: true,
    attributes: {
      key: "value",
    },
    credentials: [
      {
        temporary: false,
        type: "password",
        value: RHSSO76_DEFAULT_PASSWORD,
      },
    ],
  },
  user_1: {
    username: "rhsso_testuser1",
    email: "rhsso_testuser1@rhdh.test",
    firstName: "Testuser 1",
    lastName: "RHSSO",
    emailVerified: true,
    enabled: true,
    attributes: {
      key: "value",
    },
    credentials: [
      {
        temporary: false,
        type: "password",
        value: RHSSO76_DEFAULT_PASSWORD,
      },
    ],
    groups: [RHSSO76_GROUPS.group_1.name],
  },
  user_2: {
    username: "rhsso_testuser2",
    email: "rhsso_testuser_2@rhdh.test",
    firstName: "Testuser 2",
    lastName: "RHSSO",
    emailVerified: true,
    enabled: true,
    attributes: {
      key: "value",
    },
    credentials: [
      {
        temporary: false,
        type: "password",
        value: RHSSO76_DEFAULT_PASSWORD,
      },
    ],
    groups: [RHSSO76_GROUPS["group_2"].name],
  },
  user_3: {
    username: "rhsso_testuser3",
    email: "rhsso_testuser3@rhdh.test",
    firstName: "Testuser 3",
    lastName: "RHSSO",
    emailVerified: true,
    enabled: true,
    attributes: {
      key: "value",
    },
    credentials: [
      {
        temporary: false,
        type: "password",
        value: RHSSO76_DEFAULT_PASSWORD,
      },
    ],
    groups: [RHSSO76_GROUPS.group_4.name],
  },
  user_4: {
    username: "rhsso_testuser4",
    email: "rhsso_testuser4@rhdh.test",
    firstName: "Testuser 4",
    lastName: "RHSSO",
    emailVerified: true,
    enabled: true,
    attributes: {
      key: "value",
    },
    credentials: [
      {
        temporary: false,
        type: "password",
        value: RHSSO76_DEFAULT_PASSWORD,
      },
    ],
    groups: [RHSSO76_GROUPS.group_4.name],
  },
  jenny_doe: {
    username: "rhsso_jennydoe",
    email: "rhsso_jenny-doe@example.com",
    firstName: "Jenny",
    lastName: "Doe",
    emailVerified: true,
    enabled: true,
    attributes: {
      key: "value",
    },
    credentials: [
      {
        temporary: false,
        type: "password",
        value: RHSSO76_DEFAULT_PASSWORD,
      },
    ],
  },
};
export const RHSSO76_CLIENT: ClientRepresentation = {
  clientId: RHSSO76_CLIENTID,
  redirectUris: ["*", "/*"],
  webOrigins: ["/*"],
  serviceAccountsEnabled: true,
  standardFlowEnabled: true,
  authorizationServicesEnabled: true,
  directAccessGrantsEnabled: true,
  implicitFlowEnabled: true,
};

// required by azure
export const AZURE_LOGIN_USERNAME = process.env.AZURE_LOGIN_USERNAME;
export const AZURE_LOGIN_PASSWORD = process.env.AZURE_LOGIN_PASSWORD;
export const AUTH_PROVIDERS_AZURE_CLIENT_ID =
  process.env.AUTH_PROVIDERS_AZURE_CLIENT_ID;
export const AUTH_PROVIDERS_AZURE_CLIENT_SECRET =
  process.env.AUTH_PROVIDERS_AZURE_CLIENT_SECRET;
export const AUTH_PROVIDERS_AZURE_TENANT_ID =
  process.env.AUTH_PROVIDERS_AZURE_TENANT_ID;
export const JDOE_NEW_EMAIL = "jenny-doe-new-email@example.com";
export const AZURE_LOGIN_FIRSTNAME = "QE RHDH Testing Admin";
export const MSGRAPH_SETTINGS: AppSettings = {
  clientId: AUTH_PROVIDERS_AZURE_CLIENT_ID,
  clientSecret: AUTH_PROVIDERS_AZURE_CLIENT_SECRET,
  tenantId: AUTH_PROVIDERS_AZURE_TENANT_ID,
};
export interface AppSettings {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}
export const MSGRAPH_USERS: { [key: string]: User } = {
  admin: {
    accountEnabled: true,
    displayName: "QE Admin",
    mailNickname: "Admin",
    mail: "qeadmin@rhdhtesting.onmicrosoft.com",
    userPrincipalName: "qeadmin@rhdhtesting.onmicrosoft.com",
    passwordProfile: {
      forceChangePasswordNextSignIn: false,
      password: RHSSO76_DEFAULT_PASSWORD,
    },
  },
  user_1: {
    accountEnabled: true,
    displayName: "QE Test 1",
    mailNickname: "RHDH1",
    mail: "rhdhtest1@rhdhtesting.onmicrosoft.com",
    userPrincipalName: "rhdhtest1@rhdhtesting.onmicrosoft.com",
    passwordProfile: {
      forceChangePasswordNextSignIn: false,
      password: RHSSO76_DEFAULT_PASSWORD,
    },
  },
  user_2: {
    accountEnabled: true,
    displayName: "QE Test 2",
    mailNickname: "RHDH2",
    mail: "rhdhtest_2@rhdhtesting.onmicrosoft.com",
    userPrincipalName: "rhdhtest_2@rhdhtesting.onmicrosoft.com",
    passwordProfile: {
      forceChangePasswordNextSignIn: false,
      password: RHSSO76_DEFAULT_PASSWORD,
    },
  },
  user_3: {
    accountEnabled: true,
    displayName: "QE Test 3",
    mailNickname: "RHDH3",
    mail: "rhdhtest_3@rhdhtesting.onmicrosoft.com",
    userPrincipalName: "rhdhtest_3@rhdhtesting.onmicrosoft.com",
    passwordProfile: {
      forceChangePasswordNextSignIn: false,
      password: RHSSO76_DEFAULT_PASSWORD,
    },
  },
  user_4: {
    accountEnabled: true,
    displayName: "QE Test 4",
    mailNickname: "RHDH4",
    mail: "rhdhtest_4@rhdhtesting.onmicrosoft.com",
    userPrincipalName: "rhdhtest_4@rhdhtesting.onmicrosoft.com",
    passwordProfile: {
      forceChangePasswordNextSignIn: false,
      password: RHSSO76_DEFAULT_PASSWORD,
    },
  },
  user_5: {
    accountEnabled: true,
    displayName: "QE Test 5",
    mailNickname: "RHDH5",
    mail: "rhdhtest_5@rhdhtesting.onmicrosoft.com",
    userPrincipalName: "rhdhtest_5@rhdhtesting.onmicrosoft.com",
    passwordProfile: {
      forceChangePasswordNextSignIn: false,
      password: RHSSO76_DEFAULT_PASSWORD,
    },
  },
  user_6: {
    accountEnabled: true,
    displayName: "QE Test 6",
    mailNickname: "RHDH6",
    mail: "rhdhtest_6@rhdhtesting.onmicrosoft.com",
    userPrincipalName: "rhdhtest_6@rhdhtesting.onmicrosoft.com",
    passwordProfile: {
      forceChangePasswordNextSignIn: false,
      password: RHSSO76_DEFAULT_PASSWORD,
    },
  },
  jenny_doe: {
    accountEnabled: true,
    displayName: "QE Jenny Doe",
    mailNickname: "JDoe",
    mail: "jennydoe@rhdhtesting.onmicrosoft.com",
    userPrincipalName: "jennydoe@rhdhtesting.onmicrosoft.com",
    passwordProfile: {
      forceChangePasswordNextSignIn: false,
      password: RHSSO76_DEFAULT_PASSWORD,
    },
  },
};
export const MSGRAPH_GROUPS: { [key: string]: Group } = {
  group_1: {
    description: "Group 1 for RHDH test automation - DO NOT USE/EDIT/DELETE",
    displayName: "rhdh_test_group_1",
    groupTypes: [],
    mailEnabled: false,
    mailNickname: "rhdh_test_group_1",
    securityEnabled: true,
  },
  group_2: {
    description: "Group 2 for RHDH test automation - DO NOT USE/EDIT/DELETE",
    displayName: "rhdh_test_group_2",
    groupTypes: [],
    mailEnabled: false,
    mailNickname: "rhdh_test_group_2",
    securityEnabled: true,
  },
  group_3: {
    description: "Group 3 for RHDH test automation - DO NOT USE/EDIT/DELETE",
    displayName: "rhdh_test_group_3",
    groupTypes: [],
    mailEnabled: false,
    mailNickname: "rhdh_test_group_3",
    securityEnabled: true,
  },
  group_4: {
    description: "Group 4 for RHDH test automation - DO NOT USE/EDIT/DELETE",
    displayName: "rhdh_test_group_4",
    groupTypes: [],
    mailEnabled: false,
    mailNickname: "rhdh_test_group_4",
    securityEnabled: true,
  },
  group_5: {
    description: "Group 5 for RHDH test automation - DO NOT USE/EDIT/DELETE",
    displayName: "rhdh_test_group_5",
    groupTypes: [],
    mailEnabled: false,
    mailNickname: "rhdh_test_group_5",
    securityEnabled: true,
  },
  group_6: {
    description: "Group 6 for RHDH test automation - DO NOT USE/EDIT/DELETE",
    displayName: "rhdh_test_group_6",
    groupTypes: [],
    mailEnabled: false,
    mailNickname: "rhdh_test_group_6",
    securityEnabled: true,
  },
  location_admin: {
    description: "Group for RHDH test automation - DO NOT USE/EDIT/DELETE",
    displayName: "rhdh_test_group_location_reader",
    groupTypes: [],
    mailEnabled: false,
    mailNickname: "rhdh_test_group_location_reader",
    securityEnabled: true,
  },
};
export const GH_TEAMS: { [key: string]: { name: string } } = {
  team_1: {
    name: "gh_team_1",
  },
  team_2: {
    name: "gh_team_2",
  },
  team_3: {
    name: "gh_team_3",
  },
  team_4: {
    name: "gh_team_4",
  },
  location_admin: {
    name: "gh_team_location_reader",
  },
};
export const GH_USERS: {
  [key: string]: { name: string; displayName: string };
} = {
  user_1: {
    name: "rhdhqeauth1",
    displayName: "RHDH QE User 1",
  },
  admin: {
    name: "rhdhqeauthadmin",
    displayName: "RHDH QE Admin",
  },
};

// required by Github
export const AUTH_PROVIDERS_GH_ORG_NAME =
  process.env.AUTH_PROVIDERS_GH_ORG_NAME;
export const AUTH_ORG_APP_ID = process.env.AUTH_ORG_APP_ID;
export const AUTH_ORG_CLIENT_ID = process.env.AUTH_ORG_CLIENT_ID;
export const AUTH_ORG_CLIENT_SECRET = process.env.AUTH_ORG_CLIENT_SECRET;
export const AUTH_ORG1_PRIVATE_KEY = process.env.AUTH_ORG1_PRIVATE_KEY;
export const AUTH_ORG_PK = process.env.AUTH_ORG_PK;
export const AUTH_ORG_WEBHOOK_SECRET = process.env.AUTH_ORG_WEBHOOK_SECRET;
export const GH_USER_PASSWORD = process.env.GH_USER_PASSWORD;
export const AUTH_PROVIDERS_GH_USER_2FA =
  process.env.AUTH_PROVIDERS_GH_USER_2FA;
export const AUTH_PROVIDERS_GH_ADMIN_2FA =
  process.env.AUTH_PROVIDERS_GH_ADMIN_2FA;

// required by all auth scenarios
export const AUTH_PROVIDERS_NAMESPACE = process.env.AUTH_PROVIDERS_NAMESPACE
  ? process.env.AUTH_PROVIDERS_NAMESPACE
  : "showcase-auth-providers";
export const STATIC_API_TOKEN = process.env.STATIC_API_TOKEN
  ? process.env.STATIC_API_TOKEN
  : "somecicdtoken";
export const AUTH_PROVIDERS_RELEASE = process.env.AUTH_PROVIDERS_RELEASE
  ? process.env.AUTH_PROVIDERS_RELEASE
  : "rhdh-auth-providers";
export const AUTH_PROVIDERS_CHART = process.env.AUTH_PROVIDERS_CHART
  ? process.env.AUTH_PROVIDERS_CHART
  : "rhdh-chart/backstage";
export const CHART_VERSION = process.env.CHART_VERSION
  ? process.env.CHART_VERSION
  : "2.15.2";
export const QUAY_REPO = process.env.QUAY_REPO
  ? process.env.QUAY_REPO
  : "redhat-developer/rhdh";
export const TAG_NAME = process.env.TAG_NAME;
export const LOGS_FOLDER = process.env.LOGS_FOLDER
  ? process.env.LOGS_FOLDER
  : "/tmp/backstage-showcase/e2e-tests/auth-providers-logs";
export const AUTH_PROVIDERS_VALUES_FILE =
  "../.ibm/pipelines/value_files/values_showcase-auth-providers.yaml";
export const AUTH_PROVIDERS_BASE_URL = `https://${AUTH_PROVIDERS_RELEASE}-backstage-${AUTH_PROVIDERS_NAMESPACE}.${process.env.K8S_CLUSTER_ROUTER_BASE}`;
export const RBAC_POLICY_ROLES: string = `
p, role:default/admin, catalog-entity, read, allow
p, role:default/admin, catalog-entity, update, allow
p, role:default/admin, catalog-entity, delete, allow
p, role:default/admin, catalog.entity.create, create, allow
p, role:default/admin, catalog.entity.read, read, allow
p, role:default/admin, catalog.entity.refresh, update, allow
p, role:default/admin, catalog.entity.delete, delete, allow
p, role:default/admin, kubernetes.proxy, use, allow
p, role:default/admin, catalog.location.create, create, allow
p, role:default/admin, catalog.location.read, read, allow
p, role:default/admin, policy-entity, read, allow
p, role:default/admin, policy.entity.create, create, allow
p, role:default/reader, catalog-entity, read, allow
p, role:default/reader, catalog.entity.read, read, allow
p, role:default/reader, catalog.location.read, read, allow
p, role:default/location_admin, catalog.location.read, read, allow
p, role:default/location_admin, catalog.location.create, create, allow
p, role:default/location_admin, catalog.location.delete, delete, allow
p, role:default/location_admin, catalog.entity.read, read, allow
p, role:default/location_admin, catalog.entity.refresh, update, allow
p, role:default/location_admin, catalog.entity.delete, delete, allow
g, group:default/rhdh_test_group_1, role:default/reader
g, group:default/rhdh_test_group_2, role:default/reader
g, group:default/rhdh_test_group_3, role:default/reader
g, group:default/rhdh_test_group_4, role:default/reader
g, group:default/rhdh_test_group_5, role:default/reader
g, group:default/rhdh_test_group_6, role:default/reader
g, group:default/rhdh_test_group_location_reader, role:default/location_admin
g, user:default/qeadmin_rhdhtesting.onmicrosoft.com, role:default/admin
g, group:default/rhsso_group_1, role:default/reader
g, group:default/rhsso_group_2, role:default/reader
g, group:default/rhsso_group_3, role:default/reader
g, group:default/rhsso_group_4, role:default/reader
g, group:default/rhsso_group_location_reader, role:default/location_admin
g, user:default/rhsso_admin, role:default/admin
g, user:default/rhdhqeauthadmin, role:default/admin
g, group:default/gh_team_1, role:default/reader
g, group:default/gh_team_2, role:default/reader
g, group:default/gh_team_3, role:default/reader
g, group:default/gh_team_4, role:default/reader
g, group:default/gh_team_location_reader, role:default/location_admin
`;
