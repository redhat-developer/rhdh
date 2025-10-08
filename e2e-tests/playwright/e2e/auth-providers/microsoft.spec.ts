import { test, expect, Page, BrowserContext } from "@playwright/test";
import RHDHDeployment from "../../utils/authentication-providers/rhdh-deployment";
import { Common, setupBrowser } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";
import { MSClient } from "../../utils/authentication-providers/msgraph-helper";
import { NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE } from "../../utils/constants";
let page: Page;
let context: BrowserContext;

/* SUPPORTED RESOLVERS
MICOROSFT:
    [x] userIdMatchingUserEntityAnnotation -> (Default)
    [x] emailMatchingUserEntityAnnotation
    [x] emailMatchingUserEntityProfileEmail -> email will always match, just making sure it logs in
    [-] emailLocalPartMatchingUserEntityName
*/

test.describe("Configure Microsoft Provider", async () => {
  let common: Common;
  let uiHelper: UIhelper;

  const namespace = "albarbaro-test-namespace-msgraph";
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
    expect(process.env.DEFAULT_USER_PASSWORD_2).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_AZURE_CLIENT_ID).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_AZURE_CLIENT_SECRET).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_AZURE_TENANT_ID).toBeDefined();

    // clean old namespaces
    await deployment.deleteNamespaceIfExists();

    // create namespace and wait for it to be active
    await (await deployment.createNamespace()).waitForNamespaceActive();

    // create all base configmaps
    await deployment.createAllConfigs();

    // generate static token
    await deployment.generateStaticToken();

    // set enviroment variables and create secret
    if (!process.env.ISRUNNINGLOCAL) {
      await deployment.addSecretData("BASE_URL", backstageUrl);
      await deployment.addSecretData("BASE_BACKEND_URL", backstageBackendUrl);
    }
    await deployment.addSecretData(
      "DEFAULT_USER_PASSWORD",
      process.env.DEFAULT_USER_PASSWORD,
    );
    await deployment.addSecretData(
      "DEFAULT_USER_PASSWORD_2",
      process.env.DEFAULT_USER_PASSWORD_2,
    );
    await deployment.addSecretData(
      "AUTH_PROVIDERS_AZURE_CLIENT_ID",
      process.env.AUTH_PROVIDERS_AZURE_CLIENT_ID,
    );
    await deployment.addSecretData(
      "AUTH_PROVIDERS_AZURE_CLIENT_SECRET",
      process.env.AUTH_PROVIDERS_AZURE_CLIENT_SECRET,
    );
    await deployment.addSecretData(
      "AUTH_PROVIDERS_AZURE_TENANT_ID",
      process.env.AUTH_PROVIDERS_AZURE_TENANT_ID,
    );
    await deployment.addSecretData(
      "MICROSOFT_CLIENT_ID",
      process.env.AUTH_PROVIDERS_AZURE_CLIENT_ID,
    );
    await deployment.addSecretData(
      "MICROSOFT_CLIENT_SECRET",
      process.env.AUTH_PROVIDERS_AZURE_CLIENT_SECRET,
    );
    await deployment.addSecretData(
      "MICROSOFT_TENANT_ID",
      process.env.AUTH_PROVIDERS_AZURE_TENANT_ID,
    );

    await deployment.createSecret();

    // enable keycloak login with ingestion
    await deployment.enableMicrosoftLoginWithIngestion();
    await deployment.updateAllConfigs();

    // update the Azure App Registration to include the current redirectUrl
    console.log("[TEST] Configuring Microsoft Azure App Registration...");
    const graphClient = new MSClient(
      process.env.AUTH_PROVIDERS_AZURE_CLIENT_ID,
      process.env.AUTH_PROVIDERS_AZURE_CLIENT_SECRET,
      process.env.AUTH_PROVIDERS_AZURE_TENANT_ID,
    );

    const redirectUrl = `${backstageUrl}/api/auth/microsoft/handler/frame`;
    console.log(`[TEST] Adding redirect URL: ${redirectUrl}`);
    await graphClient.addAppRedirectUrlsAsync([redirectUrl]);
    console.log(
      "[TEST] Microsoft Azure App Registration configured successfully",
    );

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

  test("Login with Microsoft default resolver", async () => {
    const login = await common.MicrosoftAzureLogin(
      "zeus@rhdhtesting.onmicrosoft.com",
      process.env.DEFAULT_USER_PASSWORD_2,
    );
    expect(login).toBe("Login successful");

    await uiHelper.goToPageUrl("/settings", "Settings");
    await uiHelper.verifyHeading("TEST Zeus");
    await common.signOut();
    await context.clearCookies();
  });

  test("Login with Microsoft emailMatchingUserEntityAnnotation resolver", async () => {
    //Looks up the user by matching their Microsoft email to the email entity annotation.
    //User atena has no email attribute set
    await deployment.setMicrosoftResolver(
      "emailMatchingUserEntityAnnotation",
      false,
    );
    await deployment.updateAllConfigs();
    await deployment.restartLocalDeployment();
    await page.waitForTimeout(3000);
    await deployment.waitForDeploymentReady();

    // wait for rhdh first sync and portal to be reachable
    await deployment.waitForSynced();

    const login = await common.MicrosoftAzureLogin(
      "zeus@rhdhtesting.onmicrosoft.com",
      process.env.DEFAULT_USER_PASSWORD_2,
    );
    expect(login).toBe("Login successful");

    await uiHelper.goToPageUrl("/settings", "Settings");
    await uiHelper.verifyHeading("TEST Zeus");
    await common.signOut();
    await context.clearCookies();

    const login2 = await common.MicrosoftAzureLogin(
      "atena@rhdhtesting.onmicrosoft.com",
      process.env.DEFAULT_USER_PASSWORD_2,
    );
    expect(login2).toBe("Login successful");
    await uiHelper.verifyAlertErrorMessage(
      NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE,
    );
    await context.clearCookies();
  });

  test("Login with Microsoft emailMatchingUserEntityProfileEmail resolver", async () => {
    //A common sign-in resolver that looks up the user using the local part of their email address as the entity name.
    await deployment.setMicrosoftResolver(
      "emailMatchingUserEntityProfileEmail",
      false,
    );
    await deployment.updateAllConfigs();
    await deployment.restartLocalDeployment();
    await page.waitForTimeout(3000);
    await deployment.waitForDeploymentReady();

    // wait for rhdh first sync and portal to be reachable
    await deployment.waitForSynced();

    const login = await common.MicrosoftAzureLogin(
      "zeus@rhdhtesting.onmicrosoft.com",
      process.env.DEFAULT_USER_PASSWORD_2,
    );
    expect(login).toBe("Login successful");

    await uiHelper.goToPageUrl("/settings", "Settings");
    await uiHelper.verifyHeading("TEST Zeus");
    await common.signOut();
    await context.clearCookies();
  });

  //TODO: entiny name is "name": "zeus_rhdhtesting.onmicrosoft.com", email is "email": "zeus@rhdhtesting.onmicrosoft.com" not resolving?
  test.fixme(
    "Login with Microsoft emailLocalPartMatchingUserEntityName resolver",
    async () => {
      //A common sign-in resolver that looks up the user using the local part of their email address as the entity name.
      await deployment.setMicrosoftResolver(
        "emailLocalPartMatchingUserEntityName",
        false,
      );
      await deployment.updateAllConfigs();
      await deployment.restartLocalDeployment();
      await page.waitForTimeout(3000);
      await deployment.waitForDeploymentReady();

      // wait for rhdh first sync and portal to be reachable
      await deployment.waitForSynced();

      const login = await common.MicrosoftAzureLogin(
        "zeus@rhdhtesting.onmicrosoft.com",
        process.env.DEFAULT_USER_PASSWORD_2,
      );
      expect(login).toBe("Login successful");

      await uiHelper.goToPageUrl("/settings", "Settings");
      await uiHelper.verifyHeading("TEST Zeus");
      await common.signOut();
      await context.clearCookies();

      const login2 = await common.MicrosoftAzureLogin(
        "tyke@rhdhtesting.onmicrosoft.com",
        process.env.DEFAULT_USER_PASSWORD_2,
      );
      expect(login2).toBe("Login successful");

      await uiHelper.verifyAlertErrorMessage(
        NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE,
      );
    },
  );

  test(`Set Micrisoft sessionDuration and confirm in auth cookie duration has been set`, async () => {
    deployment.setAppConfigProperty(
      "auth.providers.microsoft.production.sessionDuration",
      "3days",
    );
    await deployment.updateAllConfigs();
    await deployment.restartLocalDeployment();
    await page.waitForTimeout(3000);
    await deployment.waitForDeploymentReady();

    // wait for rhdh first sync and portal to be reachable
    await deployment.waitForSynced();

    const login = await common.MicrosoftAzureLogin(
      "zeus@rhdhtesting.onmicrosoft.com",
      process.env.DEFAULT_USER_PASSWORD_2,
    );
    expect(login).toBe("Login successful");

    await page.reload();

    const cookies = await context.cookies();
    const authCookie = cookies.find(
      (cookie) => cookie.name === "microsoft-refresh-token",
    );

    const threeDays = 3 * 24 * 60 * 60 * 1000; // expected duration of 3 days in ms
    const tolerance = 3 * 60 * 1000; // allow for 3 minutes tolerance

    const actualDuration = authCookie.expires * 1000 - Date.now();

    expect(actualDuration).toBeGreaterThan(threeDays - tolerance);
    expect(actualDuration).toBeLessThan(threeDays + tolerance);

    await uiHelper.goToPageUrl("/settings", "Settings");
    await uiHelper.verifyHeading("TEST Zeus");
    await common.signOut();
  });

  test(`Ingestion of Microsoft users and groups: verify the user entities and groups are created with the correct relationships`, async () => {
    test.setTimeout(300 * 1000);
    await page.waitForTimeout(5000);

    expect(
      await deployment.checkUserIsIngestedInCatalog([
        "TEST Admin",
        "TEST Atena",
        "TEST Elio",
        "TEST Tyke",
        "TEST Zeus",
      ]),
    ).toBe(true);
    expect(
      await deployment.checkGroupIsIngestedInCatalog([
        "TEST_admins",
        "TEST_goddesses",
        "TEST_gods",
        "TEST_all",
      ]),
    ).toBe(true);
    expect(
      await deployment.checkUserIsInGroup(
        "admin_rhdhtesting.onmicrosoft.com",
        "TEST_admins",
      ),
    ).toBe(true);
    expect(
      await deployment.checkUserIsInGroup(
        "zeus_rhdhtesting.onmicrosoft.com",
        "TEST_admins",
      ),
    ).toBe(true);
    expect(
      await deployment.checkUserIsInGroup(
        "atena_rhdhtesting.onmicrosoft.com",
        "TEST_goddesses",
      ),
    ).toBe(true);
    expect(
      await deployment.checkUserIsInGroup(
        "tiche_rhdhtesting.onmicrosoft.com",
        "TEST_goddesses",
      ),
    ).toBe(true);
    expect(
      await deployment.checkUserIsInGroup(
        "elio_rhdhtesting.onmicrosoft.com",
        "TEST_gods",
      ),
    ).toBe(true);
    expect(
      await deployment.checkUserIsInGroup(
        "zeus_rhdhtesting.onmicrosoft.com",
        "TEST_gods",
      ),
    ).toBe(true);

    //expect(await deployment.checkUserIsInGroup('zeus', 'all')).toBe(true);
    //expect(await deployment.checkUserIsInGroup('tyke', 'all')).toBe(true);
    expect(
      await deployment.checkGroupIsChildOfGroup("test_gods", "test_all"),
    ).toBe(true);
    expect(
      await deployment.checkGroupIsChildOfGroup("test_goddesses", "test_all"),
    ).toBe(true);
    expect(
      await deployment.checkGroupIsParentOfGroup("test_all", "test_gods"),
    ).toBe(true);
    expect(
      await deployment.checkGroupIsParentOfGroup("test_all", "test_goddesses"),
    ).toBe(true);
  });

  test.afterAll(async () => {
    console.log("[TEST] Starting cleanup...");
    await deployment.killRunningProcess();

    // Clean up Azure App Registration
    try {
      console.log("[TEST] Cleaning up Microsoft Azure App Registration...");
      const graphClient = new MSClient(
        process.env.AUTH_PROVIDERS_AZURE_CLIENT_ID,
        process.env.AUTH_PROVIDERS_AZURE_CLIENT_SECRET,
        process.env.AUTH_PROVIDERS_AZURE_TENANT_ID,
      );

      const redirectUrl = `${backstageUrl}/api/auth/microsoft/handler/frame`;
      console.log(`[TEST] Removing redirect URL: ${redirectUrl}`);
      await graphClient.removeAppRedirectUrlsAsync([redirectUrl]);
      console.log("[TEST] Microsoft Azure App Registration cleanup completed");
    } catch (error) {
      console.error(
        "[TEST] Failed to cleanup Microsoft Azure App Registration:",
        error,
      );
      // Don't fail the test cleanup if Azure cleanup fails
    }
  });
});
