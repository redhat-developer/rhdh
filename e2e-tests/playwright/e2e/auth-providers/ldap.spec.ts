/* eslint-disable */

import { test, expect, Page, BrowserContext } from "@playwright/test";
import RHDHDeployment from "../../utils/authentication-providers/rhdh-deployment";
import { Common, setupBrowser } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";
import { MSClient } from "../../utils/authentication-providers/msgraph-helper";
let page: Page;
let context: BrowserContext;

/* SUPORTED RESOLVERS
LDAP:
    [x] -> (Default)
*/

test.describe("Configure LDAP Provider", async () => {
  let common: Common;
  let uiHelper: UIhelper;

  const namespace = "albarbaro-test-namespace-ldap";
  const appConfigMap = "app-config-rhdh";
  const rbacConfigMap = "rbac-policy";
  const dynamicPluginsConfigMap = "dynamic-plugins";
  const secretName = "rhdh-secrets";

  // set deployment instance
  const deployment: RHDHDeployment = new RHDHDeployment(
    namespace,
    appConfigMap,
    rbacConfigMap,
    dynamicPluginsConfigMap,
    secretName,
  );
  deployment.instanceName = "rhdh";

  // compute backstage baseurl
  const backstageUrl = await deployment.computeBackstageUrl();
  const backstageBackendUrl = await deployment.computeBackstageBackendUrl();
  console.log(`Backstage BaseURL is: ${backstageUrl}`);

  test.use({ baseURL: backstageUrl });

  test.beforeAll(async ({ browser }, testInfo) => {
    test.info().annotations.push({
      type: "component",
      description: "authentication",
    });

    test.info().setTimeout(600 * 1000);
    // load default configs from yaml files
    await deployment.loadAllConfigs();

    // setup playwright helpers
    ({ context, page } = await setupBrowser(browser, testInfo));
    common = new Common(page);
    uiHelper = new UIhelper(page);

    // expect some expected variables
    expect(process.env.DEFAULT_USER_PASSWORD).toBeDefined();
    expect(process.env.DEFAULT_USER_PASSWORD_2).toBeDefined();
    expect(process.env.RHBK_LDAP_REALM).toBeDefined();
    expect(process.env.RHBK_LDAP_CLIENT_ID).toBeDefined();
    expect(process.env.RHBK_LDAP_CLIENT_SECRET).toBeDefined();
    expect(process.env.RHBK_LDAP_USER_BIND).toBeDefined();
    expect(process.env.RHBK_LDAP_USER_PASSWORD).toBeDefined();
    expect(process.env.RHBK_LDAP_TARGET).toBeDefined();
    expect(process.env.RHBK_BASE_URL).toBeDefined();
    expect(process.env.RHBK_REALM).toBeDefined();
    expect(process.env.RHBK_CLIENT_ID).toBeDefined();
    expect(process.env.RHBK_CLIENT_SECRET).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_ARM_CLIENT_ID).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_ARM_CLIENT_SECRET).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_ARM_SUBSCRIPTION_ID).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_ARM_TENANT_ID).toBeDefined();

    // clean old namespaces
    await deployment.deleteNamespaceIfExists();

    // create namespace and wait for it to be active
    (await deployment.createNamespace()).waitForNamespaceActive();

    // create all base configmaps
    await deployment.createAllConfigs();

    // generate static token
    await deployment.generateStaticToken();

    // set enviroment variables and create secret
    if (!process.env.ISRUNNINGLOCAL) {
      deployment.addSecretData("BASE_URL", backstageUrl);
      deployment.addSecretData("BASE_BACKEND_URL", backstageBackendUrl);
    }

    deployment.addSecretData(
      "DEFAULT_USER_PASSWORD",
      process.env.DEFAULT_USER_PASSWORD,
    );
    deployment.addSecretData("RHBK_LDAP_REALM", process.env.RHBK_LDAP_REALM);
    deployment.addSecretData(
      "RHBK_LDAP_CLIENT_ID",
      process.env.RHBK_LDAP_CLIENT_ID,
    );
    deployment.addSecretData(
      "RHBK_LDAP_CLIENT_SECRET",
      process.env.RHBK_LDAP_CLIENT_SECRET,
    );
    deployment.addSecretData("LDAP_BIND_DN", process.env.RHBK_LDAP_USER_BIND);
    deployment.addSecretData(
      "LDAP_BIND_SECRET",
      process.env.RHBK_LDAP_USER_PASSWORD,
    );
    deployment.addSecretData("LDAP_TARGET_URL", process.env.RHBK_LDAP_TARGET);
    deployment.addSecretData(
      "DEFAULT_USER_PASSWORD",
      process.env.DEFAULT_USER_PASSWORD,
    );
    deployment.addSecretData(
      "DEFAULT_USER_PASSWORD_2",
      process.env.DEFAULT_USER_PASSWORD_2,
    );
    deployment.addSecretData(
      "LDAP_GROUPS_DN",
      "OU=Groups,OU=RHDH Local,DC=rhdh,DC=test",
    );
    deployment.addSecretData(
      "LDAP_USERS_DN",
      "OU=Users,OU=RHDH Local,DC=rhdh,DC=test",
    );
    deployment.addSecretData("RHBK_BASE_URL", process.env.RHBK_BASE_URL);
    deployment.addSecretData("RHBK_REALM", process.env.RHBK_REALM);
    deployment.addSecretData("RHBK_CLIENT_ID", process.env.RHBK_CLIENT_ID);
    deployment.addSecretData(
      "RHBK_CLIENT_SECRET",
      process.env.RHBK_CLIENT_SECRET,
    );

    deployment.addSecretData(
      "AUTH_PROVIDERS_GH_ORG_CLIENT_ID",
      process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_ID,
    );
    deployment.addSecretData(
      "AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET",
      process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET,
    );

    await deployment.createSecret();

    // enable ldap login with ingestion through RHBK
    await deployment.enableLDAPLoginWithIngestion();
    await deployment.setOIDCResolver("oidcLdapUuidMatchingAnnotation");
    await deployment.updateAllConfigs();

    // update the Azure App Registration to include the current redirectUrl
    console.log("[TEST] Configuring Microsoft Azure App Registration...");
    const graphClient = new MSClient(
      process.env.AUTH_PROVIDERS_ARM_CLIENT_ID!,
      process.env.AUTH_PROVIDERS_ARM_CLIENT_SECRET!,
      process.env.AUTH_PROVIDERS_ARM_TENANT_ID!,
      process.env.AUTH_PROVIDERS_ARM_SUBSCRIPTION_ID!,
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
      (test as any).nsgCleanup = nsgConfig.cleanup;
    } catch (error) {
      console.error("[TEST] Failed to configure NSG access:", error);
      // Continue with test even if NSG configuration fails
    }

    // create backstage deployment and wait for it to be ready
    await deployment.createBackstageDeployment();
    await deployment.waitForDeploymentReady();

    // wait for rhdh first sync and portal to be reachable
    await deployment.waitForSynced();
  });

  test.beforeEach(async () => {
    test.info().setTimeout(600 * 1000);
    console.log(
      `Running test case ${test.info().title} - Attempt #${test.info().retry}`,
    );
  });

  test("Login with LDAP oidcLdapUuidMatchingAnnotation resolver", async () => {
    const login = await common.keycloakLogin(
      "user1@rhdh.test",
      process.env.RHBK_LDAP_USER_PASSWORD,
    );
    expect(login).toBe("Login successful");

    await uiHelper.goToPageUrl("/settings", "Settings");
    await uiHelper.verifyHeading("User 1");
    await common.signOut();
  });

  test(`Ingestion of LDAP users and groups: verify the user entities and groups are created with the correct relationships`, async () => {
    expect(
      await deployment.checkUserIsIngestedInCatalog([
        "User 1",
        "User 2",
        "User 3",
        "RHDH Admin",
      ]),
    ).toBe(true);

    expect(
      await deployment.checkGroupIsIngestedInCatalog([
        "Admins",
        "All_Users",
        "testGroup",
        "testSubGroup",
        "testSubSubGroup",
        "SubAdmins",
      ]),
    ).toBe(true);
    expect(await deployment.checkUserIsInGroup("rhdh-admin", "Admins")).toBe(
      true,
    );
    expect(await deployment.checkUserIsInGroup("user1", "All_Users")).toBe(
      true,
    );
    expect(await deployment.checkUserIsInGroup("user2", "All_Users")).toBe(
      true,
    );

    expect(
      await deployment.checkGroupIsChildOfGroup("testsubgroup", "testgroup"),
    ).toBe(true);
    expect(
      await deployment.checkGroupIsChildOfGroup(
        "testsubsubgroup",
        "testsubgroup",
      ),
    ).toBe(true);
    expect(
      await deployment.checkGroupIsParentOfGroup("testgroup", "testsubgroup"),
    ).toBe(true);
    expect(
      await deployment.checkGroupIsParentOfGroup(
        "testsubgroup",
        "testsubsubgroup",
      ),
    ).toBe(true);
  });

  test.afterAll(async () => {
    console.log("[TEST] Starting cleanup...");

    // Clean up NSG rule
    try {
      const nsgCleanup = (test as any).nsgCleanup;
      if (nsgCleanup && typeof nsgCleanup === "function") {
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
  });
});
