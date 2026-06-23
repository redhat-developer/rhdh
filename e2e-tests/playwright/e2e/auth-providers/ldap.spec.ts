import { test, expect, Page, BrowserContext } from "@support/coverage/test";
import RHDHDeployment from "../../utils/authentication-providers/rhdh-deployment";
import { Common } from "../../utils/common";
import { MSClient } from "../../utils/authentication-providers/msgraph-helper";
import { SettingsPage } from "../../support/pages/settings-page";
import {
  createManagedBrowserSession,
  type ManagedBrowserSession,
} from "../../support/fixtures/managed-browser";

let page: Page;
let browserContext: BrowserContext;
let browserSession: ManagedBrowserSession;
let nsgCleanup: (() => Promise<void>) | undefined;

/* SUPPORTED RESOLVERS
LDAP:
    [x] oidcLdapUuidMatchingAnnotation -> (Default)
*/

const namespace = "albarbaro-test-namespace-ldap";
const appConfigMap = "app-config-rhdh";
const rbacConfigMap = "rbac-policy";
const dynamicPluginsConfigMap = "dynamic-plugins";
const secretName = "rhdh-secrets";

const deployment = new RHDHDeployment(
  namespace,
  appConfigMap,
  rbacConfigMap,
  dynamicPluginsConfigMap,
  secretName,
);
deployment.instanceName = "rhdh";

const backstageUrl = await deployment.computeBackstageUrl();
const backstageBackendUrl = await deployment.computeBackstageBackendUrl();
console.log(`Backstage BaseURL is: ${backstageUrl}`);

test.describe("Configure LDAP Provider", () => {
  let common: Common;
  let settingsPage: SettingsPage;

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
    browserSession = await createManagedBrowserSession(browser, testInfo);
    browserContext = browserSession.context;
    page = browserSession.page;
    void browserContext;
    common = new Common(page);
    settingsPage = new SettingsPage(page);

    // expect some expected variables
    expect(process.env.DEFAULT_USER_PASSWORD!).toBeDefined();
    expect(process.env.DEFAULT_USER_PASSWORD_2!).toBeDefined();
    expect(process.env.RHBK_LDAP_REALM!).toBeDefined();
    expect(process.env.RHBK_LDAP_CLIENT_ID!).toBeDefined();
    expect(process.env.RHBK_LDAP_CLIENT_SECRET!).toBeDefined();
    expect(process.env.RHBK_LDAP_USER_BIND!).toBeDefined();
    expect(process.env.RHBK_LDAP_USER_PASSWORD!).toBeDefined();
    expect(process.env.RHBK_LDAP_TARGET!).toBeDefined();
    expect(process.env.RHBK_BASE_URL!).toBeDefined();
    expect(process.env.RHBK_REALM!).toBeDefined();
    expect(process.env.RHBK_CLIENT_ID!).toBeDefined();
    expect(process.env.RHBK_CLIENT_SECRET!).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_ARM_CLIENT_ID!).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_ARM_CLIENT_SECRET!).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_ARM_SUBSCRIPTION_ID!).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_ARM_TENANT_ID!).toBeDefined();

    // clean old namespaces
    await deployment.deleteNamespaceIfExists();

    // create namespace and wait for it to be active
    await (await deployment.createNamespace()).waitForNamespaceActive();

    // create all base configmaps
    await deployment.createAllConfigs();

    // generate static token
    await deployment.generateStaticToken();

    // set enviroment variables and create secret
    if (
      process.env.ISRUNNINGLOCAL === undefined ||
      process.env.ISRUNNINGLOCAL === "" ||
      process.env.ISRUNNINGLOCAL === "false"
    ) {
      await deployment.addSecretData("BASE_URL", backstageUrl);
      await deployment.addSecretData("BASE_BACKEND_URL", backstageBackendUrl);
    }

    await deployment.addSecretData(
      "DEFAULT_USER_PASSWORD",
      process.env.DEFAULT_USER_PASSWORD!,
    );
    await deployment.addSecretData(
      "RHBK_LDAP_REALM",
      process.env.RHBK_LDAP_REALM!,
    );
    await deployment.addSecretData(
      "RHBK_LDAP_CLIENT_ID",
      process.env.RHBK_LDAP_CLIENT_ID!,
    );
    await deployment.addSecretData(
      "RHBK_LDAP_CLIENT_SECRET",
      process.env.RHBK_LDAP_CLIENT_SECRET!,
    );
    await deployment.addSecretData(
      "LDAP_BIND_DN",
      process.env.RHBK_LDAP_USER_BIND!,
    );
    await deployment.addSecretData(
      "LDAP_BIND_SECRET",
      process.env.RHBK_LDAP_USER_PASSWORD!,
    );
    await deployment.addSecretData(
      "LDAP_TARGET_URL",
      process.env.RHBK_LDAP_TARGET!,
    );
    await deployment.addSecretData(
      "DEFAULT_USER_PASSWORD",
      process.env.DEFAULT_USER_PASSWORD!,
    );
    await deployment.addSecretData(
      "DEFAULT_USER_PASSWORD_2",
      process.env.DEFAULT_USER_PASSWORD_2!,
    );
    await deployment.addSecretData(
      "LDAP_GROUPS_DN",
      "OU=Groups,OU=RHDH Local,DC=rhdh,DC=test",
    );
    await deployment.addSecretData(
      "LDAP_USERS_DN",
      "OU=Users,OU=RHDH Local,DC=rhdh,DC=test",
    );
    await deployment.addSecretData("RHBK_BASE_URL", process.env.RHBK_BASE_URL!);
    await deployment.addSecretData("RHBK_REALM", process.env.RHBK_REALM!);
    await deployment.addSecretData(
      "RHBK_CLIENT_ID",
      process.env.RHBK_CLIENT_ID!,
    );
    await deployment.addSecretData(
      "RHBK_CLIENT_SECRET",
      process.env.RHBK_CLIENT_SECRET!,
    );

    await deployment.addSecretData(
      "AUTH_PROVIDERS_GH_ORG_CLIENT_ID",
      process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_ID!,
    );
    await deployment.addSecretData(
      "AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET",
      process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET!,
    );

    await deployment.addSecretData(
      "PINGFEDERATE_BASE_URL",
      process.env.PINGFEDERATE_BASE_URL!,
    );
    await deployment.addSecretData(
      "PINGFEDERATE_CLIENT_ID",
      process.env.PINGFEDERATE_CLIENT_ID!,
    );
    await deployment.addSecretData(
      "PINGFEDERATE_CLIENT_SECRET",
      process.env.PINGFEDERATE_CLIENT_SECRET!,
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

    // create backstage deployment and wait for it to be ready
    await deployment.createBackstageDeployment();
    await deployment.waitForDeploymentReady();

    // wait for rhdh first sync and portal to be reachable
    await deployment.waitForSynced();
  });

  test.beforeEach(() => {
    test.info().setTimeout(600 * 1000);
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

  test("Login with PingFederate OIDC (with LDAP catalog)", async () => {
    // Switch from RHBK auth to PingFederate auth (LDAP catalog remains)
    await deployment.enablePingFederateOIDCLogin();

    await deployment.updateAllConfigs();
    await deployment.waitForConfigReconciled();
    await deployment.restartLocalDeployment();
    await deployment.waitForDeploymentReady();

    // Wait for rhdh first sync and portal to be reachable
    await deployment.waitForSynced();

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
    await deployment.enablePingFederateOIDCLogin();

    deployment.setAppConfigProperty(
      "auth.providers.oidc.production.signIn.resolvers",
      [
        {
          resolver: "oidcLdapUuidMatchingAnnotation",
          // match sub claim as required by OIDC spec
          ldapUuidKey: "sub",
        },
      ],
    );

    await deployment.updateAllConfigs();
    await deployment.waitForConfigReconciled();
    await deployment.restartLocalDeployment();
    await deployment.waitForDeploymentReady();

    // Wait for rhdh first sync and portal to be reachable
    await deployment.waitForSynced();

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
    if (browserSession !== undefined) {
      await browserSession.dispose();
    }
    console.log("[TEST] Starting cleanup...");
    await deployment.killRunningProcess();

    // Clean up NSG rule
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
  });
});
