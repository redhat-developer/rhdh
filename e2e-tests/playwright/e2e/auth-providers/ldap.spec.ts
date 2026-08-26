import { test, expect } from "@support/coverage/test";

import { AuthProviderSession } from "../../support/auth/provider-auth";
import { createAuthProviderHarness } from "../../support/fixtures/auth-provider-playwright";
import { SettingsPage } from "../../support/pages/settings-page";
import { MSClient } from "../../utils/authentication-providers/msgraph-helper";

/* SUPPORTED RESOLVERS
LDAP:
    [x] oidcLdapUuidMatchingAnnotation -> (Default)
*/

const harness = createAuthProviderHarness("albarbaro-test-namespace-ldap");

let nsgCleanup: (() => Promise<void>) | undefined;

test.describe("Configure LDAP Provider", () => {
  let authSession: AuthProviderSession;
  let settingsPage: SettingsPage;
  let clearSession: (() => Promise<void>) | undefined;

  test.beforeAll(async ({ rhdhPage, rhdhContext, rhdhAuthSession }) => {
    test.info().annotations.push({
      type: "component",
      description: "authentication",
    });

    authSession = rhdhAuthSession;
    settingsPage = new SettingsPage(rhdhPage);
    clearSession = async () => {
      await authSession.clearAuthState(rhdhContext);
    };

    await harness.prepareProvider({
      requiredEnvVars: [
        "DEFAULT_USER_PASSWORD",
        "DEFAULT_USER_PASSWORD_2",
        "RHBK_LDAP_REALM",
        "RHBK_LDAP_CLIENT_ID",
        "RHBK_LDAP_CLIENT_SECRET",
        "RHBK_LDAP_USER_BIND",
        "RHBK_LDAP_USER_PASSWORD",
        "RHBK_LDAP_TARGET",
        "RHBK_BASE_URL",
        "RHBK_REALM",
        "RHBK_CLIENT_ID",
        "RHBK_CLIENT_SECRET",
        "AUTH_PROVIDERS_ARM_CLIENT_ID",
        "AUTH_PROVIDERS_ARM_CLIENT_SECRET",
        "AUTH_PROVIDERS_ARM_SUBSCRIPTION_ID",
        "AUTH_PROVIDERS_ARM_TENANT_ID",
      ],
      envSecrets: {
        DEFAULT_USER_PASSWORD: "DEFAULT_USER_PASSWORD",
        RHBK_LDAP_REALM: "RHBK_LDAP_REALM",
        RHBK_LDAP_CLIENT_ID: "RHBK_LDAP_CLIENT_ID",
        RHBK_LDAP_CLIENT_SECRET: "RHBK_LDAP_CLIENT_SECRET",
        LDAP_BIND_DN: "RHBK_LDAP_USER_BIND",
        LDAP_BIND_SECRET: "RHBK_LDAP_USER_PASSWORD",
        LDAP_TARGET_URL: "RHBK_LDAP_TARGET",
        DEFAULT_USER_PASSWORD_2: "DEFAULT_USER_PASSWORD_2",
        RHBK_BASE_URL: "RHBK_BASE_URL",
        RHBK_REALM: "RHBK_REALM",
        RHBK_CLIENT_ID: "RHBK_CLIENT_ID",
        RHBK_CLIENT_SECRET: "RHBK_CLIENT_SECRET",
        AUTH_PROVIDERS_GH_ORG_CLIENT_ID: "AUTH_PROVIDERS_GH_ORG_CLIENT_ID",
        AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET: "AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET",
        PINGFEDERATE_BASE_URL: "PINGFEDERATE_BASE_URL",
        PINGFEDERATE_CLIENT_ID: "PINGFEDERATE_CLIENT_ID",
        PINGFEDERATE_CLIENT_SECRET: "PINGFEDERATE_CLIENT_SECRET",
      },
      extraSecrets: {
        LDAP_GROUPS_DN: "OU=Groups,OU=RHDH Local,DC=rhdh,DC=test",
        LDAP_USERS_DN: "OU=Users,OU=RHDH Local,DC=rhdh,DC=test",
      },
      enableProvider: async (deployment) => {
        await deployment.enableLDAPLoginWithIngestion();
        await deployment.setOIDCResolver("oidcLdapUuidMatchingAnnotation");
      },
      beforeDeploy: async () => {
        console.log("[TEST] Configuring Microsoft Azure App Registration...");
        const graphClient = new MSClient(
          process.env.AUTH_PROVIDERS_ARM_CLIENT_ID!,
          process.env.AUTH_PROVIDERS_ARM_CLIENT_SECRET!,
          process.env.AUTH_PROVIDERS_ARM_TENANT_ID!,
          process.env.AUTH_PROVIDERS_ARM_SUBSCRIPTION_ID,
        );

        try {
          const nsgConfig = await graphClient.allowPublicIpInNSG(
            "ldap-test",
            "ldap-test-nsg",
            "AllowE2EJobs",
          );
          console.log(`[TEST] NSG access configured successfully`);
          console.log(`[TEST] Rule created: ${nsgConfig.ruleName} for IP: ${nsgConfig.publicIp}`);
          nsgCleanup = nsgConfig.cleanup;
        } catch (error) {
          console.error("[TEST] Failed to configure NSG access:", error);
        }
      },
    });
  });

  test.beforeEach(() => {
    console.log(`Running test case ${test.info().title} - Attempt #${test.info().retry}`);
  });

  test("Login with LDAP oidcLdapUuidMatchingAnnotation resolver", async () => {
    await harness.runLoginCase({
      login: () =>
        authSession.loginWithKeycloak("user1@rhdh.test", process.env.RHBK_LDAP_USER_PASSWORD!),
      assert: async () => {
        await settingsPage.open();
        await settingsPage.verifyProfileHeading("User 1");
        await settingsPage.signOut();
      },
      cleanup: clearSession,
    });
  });

  test(`Ingestion of LDAP users and groups: verify the user entities and groups are created with the correct relationships`, async () => {
    await expect(
      harness.deployment.checkUserIsIngestedInCatalog(["User 1", "User 2", "User 3", "RHDH Admin"]),
    ).resolves.toBeUndefined();

    await expect(
      harness.deployment.checkGroupIsIngestedInCatalog([
        "Admins",
        "All_Users",
        "testGroup",
        "testSubGroup",
        "testSubSubGroup",
        "SubAdmins",
      ]),
    ).resolves.toBeUndefined();
    await expect(
      harness.deployment.checkUserIsInGroup("rhdh-admin", "Admins"),
    ).resolves.toBeUndefined();
    await expect(
      harness.deployment.checkUserIsInGroup("user1", "All_Users"),
    ).resolves.toBeUndefined();
    await expect(
      harness.deployment.checkUserIsInGroup("user2", "All_Users"),
    ).resolves.toBeUndefined();

    await expect(
      harness.deployment.checkGroupIsChildOfGroup("testsubgroup", "testgroup"),
    ).resolves.toBeUndefined();
    await expect(
      harness.deployment.checkGroupIsChildOfGroup("testsubsubgroup", "testsubgroup"),
    ).resolves.toBeUndefined();
    await expect(
      harness.deployment.checkGroupIsParentOfGroup("testgroup", "testsubgroup"),
    ).resolves.toBeUndefined();
    await expect(
      harness.deployment.checkGroupIsParentOfGroup("testsubgroup", "testsubsubgroup"),
    ).resolves.toBeUndefined();
  });

  test("Login with PingFederate OIDC (with LDAP catalog)", async () => {
    await harness.runLoginCase({
      configure: async () => {
        await harness.deployment.enablePingFederateOIDCLogin();
        await harness.reconcileAfterConfigChange();
      },
      login: () => authSession.loginWithPingFederate("user1", process.env.RHBK_LDAP_USER_PASSWORD!),
      assert: async () => {
        await settingsPage.open();
        await settingsPage.verifyProfileHeading("User 1");
        await settingsPage.signOut();
      },
      cleanup: clearSession,
    });
  });

  test("Login with PingFederate OIDC (with LDAP catalog) with sub as ldap_uuid", async () => {
    await harness.runLoginCase({
      configure: async () => {
        await harness.deployment.enablePingFederateOIDCLogin();
        harness.deployment.setAppConfigProperty("auth.providers.oidc.production.signIn.resolvers", [
          {
            resolver: "oidcLdapUuidMatchingAnnotation",
            ldapUuidKey: "sub",
          },
        ]);
        await harness.reconcileAfterConfigChange();
      },
      login: () => authSession.loginWithPingFederate("user1", process.env.RHBK_LDAP_USER_PASSWORD!),
      assert: async () => {
        await settingsPage.open();
        await settingsPage.verifyProfileHeading("User 1");
        await settingsPage.signOut();
      },
      cleanup: clearSession,
    });
  });

  test.afterAll(async () => {
    try {
      if (nsgCleanup) {
        console.log("[TEST] Cleaning up NSG rule...");
        await nsgCleanup();
        console.log("[TEST] NSG cleanup completed");
      } else {
        console.log("[TEST] No NSG cleanup function found - skipping");
      }
    } catch (error) {
      console.error("[TEST] Failed to cleanup NSG:", error);
      // Don't fail the test cleanup if NSG cleanup fails
    }

    await harness.cleanup();
  });
});
