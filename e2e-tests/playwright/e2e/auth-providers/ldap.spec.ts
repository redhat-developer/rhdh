import { test, expect } from "@support/coverage/test";
import { AuthProviderHarness } from "../../support/fixtures/auth-provider-harness";
import { Common } from "../../utils/common";
import { MSClient } from "../../utils/authentication-providers/msgraph-helper";
import { SettingsPage } from "../../support/pages/settings-page";

/* SUPPORTED RESOLVERS
LDAP:
    [x] oidcLdapUuidMatchingAnnotation -> (Default)
*/

const harness = await AuthProviderHarness.create(
  "albarbaro-test-namespace-ldap",
);

let nsgCleanup: (() => Promise<void>) | undefined;

test.describe("Configure LDAP Provider", () => {
  test.use({ baseURL: harness.backstageUrl });

  let common: Common;
  let settingsPage: SettingsPage;

  test.beforeAll(async ({ rhdhPage }) => {
    test.info().annotations.push({
      type: "component",
      description: "authentication",
    });

    common = new Common(rhdhPage);
    settingsPage = new SettingsPage(rhdhPage);

    harness.expectEnvVars([
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
    ]);

    await harness.loadConfigsAndProvisionNamespace();
    await harness.addBaseUrlSecretsIfRemote();
    await harness.addSecretsFromEnv({
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
      AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET:
        "AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET",
      PINGFEDERATE_BASE_URL: "PINGFEDERATE_BASE_URL",
      PINGFEDERATE_CLIENT_ID: "PINGFEDERATE_CLIENT_ID",
      PINGFEDERATE_CLIENT_SECRET: "PINGFEDERATE_CLIENT_SECRET",
    });
    await harness.deployment.addSecretData(
      "DEFAULT_USER_PASSWORD",
      process.env.DEFAULT_USER_PASSWORD!,
    );
    await harness.deployment.addSecretData(
      "LDAP_GROUPS_DN",
      "OU=Groups,OU=RHDH Local,DC=rhdh,DC=test",
    );
    await harness.deployment.addSecretData(
      "LDAP_USERS_DN",
      "OU=Users,OU=RHDH Local,DC=rhdh,DC=test",
    );
    await harness.createSecret();

    await harness.deployment.enableLDAPLoginWithIngestion();
    await harness.deployment.setOIDCResolver("oidcLdapUuidMatchingAnnotation");
    await harness.deployment.updateAllConfigs();

    console.log("[TEST] Configuring Microsoft Azure App Registration...");
    const graphClient = new MSClient(
      process.env.AUTH_PROVIDERS_ARM_CLIENT_ID!,
      process.env.AUTH_PROVIDERS_ARM_CLIENT_SECRET!,
      process.env.AUTH_PROVIDERS_ARM_TENANT_ID!,
      process.env.AUTH_PROVIDERS_ARM_SUBSCRIPTION_ID,
    );

    // Allow public IP in NSG for E2E testing
    try {
      const nsgConfig = await graphClient.allowPublicIpInNSG(
        "ldap-test",
        "ldap-test-nsg",
        "AllowE2EJobs",
      );
      console.log(`[TEST] NSG access configured successfully`);
      console.log(
        `[TEST] Rule created: ${nsgConfig.ruleName} for IP: ${nsgConfig.publicIp}`,
      );

      // Store cleanup function for afterAll
      nsgCleanup = nsgConfig.cleanup;
    } catch (error) {
      console.error("[TEST] Failed to configure NSG access:", error);
      // Continue with test even if NSG configuration fails
    }

    await harness.deployAndWait();
  });

  test.beforeEach(() => {
    console.log(
      `Running test case ${test.info().title} - Attempt #${test.info().retry}`,
    );
  });

  test("Login with LDAP oidcLdapUuidMatchingAnnotation resolver", async () => {
    const login = await common.keycloakLogin(
      "user1@rhdh.test",
      process.env.RHBK_LDAP_USER_PASSWORD!,
    );
    expect(login).toBe("Login successful");

    await settingsPage.open();
    await settingsPage.verifyProfileHeading("User 1");
    await common.signOut();
  });

  test(`Ingestion of LDAP users and groups: verify the user entities and groups are created with the correct relationships`, async () => {
    expect(
      await harness.deployment.checkUserIsIngestedInCatalog([
        "User 1",
        "User 2",
        "User 3",
        "RHDH Admin",
      ]),
    ).toBe(true);

    expect(
      await harness.deployment.checkGroupIsIngestedInCatalog([
        "Admins",
        "All_Users",
        "testGroup",
        "testSubGroup",
        "testSubSubGroup",
        "SubAdmins",
      ]),
    ).toBe(true);
    expect(
      await harness.deployment.checkUserIsInGroup("rhdh-admin", "Admins"),
    ).toBe(true);
    expect(
      await harness.deployment.checkUserIsInGroup("user1", "All_Users"),
    ).toBe(true);
    expect(
      await harness.deployment.checkUserIsInGroup("user2", "All_Users"),
    ).toBe(true);

    expect(
      await harness.deployment.checkGroupIsChildOfGroup(
        "testsubgroup",
        "testgroup",
      ),
    ).toBe(true);
    expect(
      await harness.deployment.checkGroupIsChildOfGroup(
        "testsubsubgroup",
        "testsubgroup",
      ),
    ).toBe(true);
    expect(
      await harness.deployment.checkGroupIsParentOfGroup(
        "testgroup",
        "testsubgroup",
      ),
    ).toBe(true);
    expect(
      await harness.deployment.checkGroupIsParentOfGroup(
        "testsubgroup",
        "testsubsubgroup",
      ),
    ).toBe(true);
  });

  test("Login with PingFederate OIDC (with LDAP catalog)", async () => {
    // Switch from RHBK auth to PingFederate auth (LDAP catalog remains)
    await harness.deployment.enablePingFederateOIDCLogin();
    await harness.reconcileAfterConfigChange();

    const login = await common.pingFederateLogin(
      "user1",
      process.env.RHBK_LDAP_USER_PASSWORD!,
    );
    expect(login).toBe("Login successful");

    await settingsPage.open();
    await settingsPage.verifyProfileHeading("User 1");
    await common.signOut();
  });

  test("Login with PingFederate OIDC (with LDAP catalog) with sub as ldap_uuid", async () => {
    await harness.deployment.enablePingFederateOIDCLogin();

    harness.deployment.setAppConfigProperty(
      "auth.providers.oidc.production.signIn.resolvers",
      [
        {
          resolver: "oidcLdapUuidMatchingAnnotation",
          // match sub claim as required by OIDC spec
          ldapUuidKey: "sub",
        },
      ],
    );

    await harness.reconcileAfterConfigChange();

    const login = await common.pingFederateLogin(
      "user1",
      process.env.RHBK_LDAP_USER_PASSWORD!,
    );
    expect(login).toBe("Login successful");

    await settingsPage.open();
    await settingsPage.verifyProfileHeading("User 1");
    await common.signOut();
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
