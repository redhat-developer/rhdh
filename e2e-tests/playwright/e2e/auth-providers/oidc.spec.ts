import { test, expect, Page, BrowserContext } from "@playwright/test";
import RHDHDeployment from "../../utils/authentication-providers/rhdh-deployment";
import { Common, setupBrowser } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";
import { KeycloakHelper } from "../../utils/authentication-providers/keycloak-helper";
import { NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE } from "../../utils/constants";
let page: Page;
let context: BrowserContext;

/* SUPPORTED RESOLVERS
OIDC:
    ❗Changed from 1.5
    [x] oidcSubClaimMatchingIdPUserId -> (Default, no setting specified)
    [x] oidcSubClaimMatchingKeycloakUserId -> (same as above, but need to be set explicitly in the config)
    [x] preferredUsernameMatchingUserEntityName (patched)
    [x] emailLocalPartMatchingUserEntityName
    [x] emailMatchingUserEntityProfileEmail -> email will always match, just making sure it logs in
    [-] oidcSubClaimMatchingPingIdentityUserId -> Ping Identity not supported
*/

test.describe("Configure OIDC provider (using RHBK)", async () => {
  let common: Common;
  let uiHelper: UIhelper;

  const namespace = "albarbaro-test-namespace-oidc";
  const appConfigMap = "app-config-rhdh";
  const rbacConfigMap = "rbac-policy";
  const dynamicPluginsConfigMap = "dynamic-plugins";
  const secretName = "rhdh-secrets";

  const keycloakHelper = new KeycloakHelper({
    baseUrl: process.env.RHBK_BASE_URL,
    realmName: process.env.RHBK_REALM,
    clientId: process.env.RHBK_CLIENT_ID,
    clientSecret: process.env.RHBK_CLIENT_SECRET,
  });

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

    // initialize keycloak helper
    console.log("[TEST] Initializing Keycloak helper...");
    await keycloakHelper.initialize();
    console.log("[TEST] Keycloak helper initialized successfully");

    // expect some expected variables
    expect(process.env.DEFAULT_USER_PASSWORD).toBeDefined();
    expect(process.env.RHBK_BASE_URL).toBeDefined();
    expect(process.env.RHBK_REALM).toBeDefined();
    expect(process.env.RHBK_CLIENT_ID).toBeDefined();
    expect(process.env.RHBK_CLIENT_SECRET).toBeDefined();

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
    await deployment.addSecretData("RHBK_BASE_URL", process.env.RHBK_BASE_URL);
    await deployment.addSecretData("RHBK_REALM", process.env.RHBK_REALM);
    await deployment.addSecretData(
      "RHBK_CLIENT_ID",
      process.env.RHBK_CLIENT_ID,
    );
    await deployment.addSecretData(
      "RHBK_CLIENT_SECRET",
      process.env.RHBK_CLIENT_SECRET,
    );

    await deployment.addSecretData(
      "AUTH_PROVIDERS_GH_ORG_CLIENT_ID",
      process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_ID,
    );
    await deployment.addSecretData(
      "AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET",
      process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET,
    );

    await deployment.createSecret();

    // create initial deployment
    // enable keycloak login with ingestion
    console.log("[TEST] Enabling OIDC login with ingestion...");
    await deployment.enableOIDCLoginWithIngestion();
    await deployment.updateAllConfigs();
    console.log("[TEST] OIDC login with ingestion enabled successfully");

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

  test("Login with OIDC default resolver", async () => {
    const login = await common.keycloakLogin(
      "zeus",
      process.env.DEFAULT_USER_PASSWORD,
    );
    expect(login).toBe("Login successful");

    await uiHelper.goToPageUrl("/settings", "Settings");
    await uiHelper.verifyHeading("Zeus Giove");
    await common.signOut();
  });

  test("Login with OIDC oidcSubClaimMatchingKeycloakUserId resolver", async () => {
    await deployment.enableOIDCLoginWithIngestion();
    await deployment.setOIDCResolver(
      "oidcSubClaimMatchingKeycloakUserId",
      false,
    );
    await deployment.updateAllConfigs();
    await page.waitForTimeout(3000);
    await deployment.restartLocalDeployment();
    await deployment.waitForDeploymentReady();

    // wait for rhdh first sync and portal to be reachable
    await deployment.waitForSynced();

    const login = await common.keycloakLogin(
      "zeus",
      process.env.DEFAULT_USER_PASSWORD,
    );
    expect(login).toBe("Login successful");

    await uiHelper.goToPageUrl("/settings", "Settings");
    await uiHelper.verifyHeading("Zeus Giove");
    await common.signOut();
  });

  test("Login with OIDC emailMatchingUserEntityProfileEmail resolver", async () => {
    await deployment.setOIDCResolver(
      "emailMatchingUserEntityProfileEmail",
      false,
    );
    await deployment.updateAllConfigs();
    await deployment.restartLocalDeployment();
    await page.waitForTimeout(3000);
    await deployment.waitForDeploymentReady();

    // wait for rhdh first sync and portal to be reachable
    await deployment.waitForSynced();

    const login = await common.keycloakLogin(
      "zeus",
      process.env.DEFAULT_USER_PASSWORD,
    );
    expect(login).toBe("Login successful");

    await uiHelper.goToPageUrl("/settings", "Settings");
    await uiHelper.verifyHeading("Zeus Giove");
    await common.signOut();
  });

  test("Login with OIDC emailLocalPartMatchingUserEntityName resolver", async () => {
    await deployment.setOIDCResolver(
      "emailLocalPartMatchingUserEntityName",
      false,
    );
    await deployment.updateAllConfigs();
    await deployment.restartLocalDeployment();
    await page.waitForTimeout(3000);
    await deployment.waitForDeploymentReady();

    // wait for rhdh first sync and portal to be reachable
    await deployment.waitForSynced();

    const login = await common.keycloakLogin(
      "zeus",
      process.env.DEFAULT_USER_PASSWORD,
    );
    expect(login).toBe("Login successful");

    await uiHelper.goToPageUrl("/settings", "Settings");
    await uiHelper.verifyHeading("Zeus Giove");
    await common.signOut();

    const login2 = await common.keycloakLogin(
      "atena",
      process.env.DEFAULT_USER_PASSWORD,
    );
    expect(login2).toBe("Login successful");

    await uiHelper.verifyAlertErrorMessage(
      NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE,
    );
    await keycloakHelper.initialize();
    await keycloakHelper.clearUserSessions("atena");
  });

  test("Login with OIDC emailLocalPartMatchingUserEntityName with dangerouslyAllowSignInWithoutUserInCatalog resolver", async () => {
    await deployment.setOIDCResolver(
      "emailLocalPartMatchingUserEntityName",
      true,
    );
    await deployment.updateAllConfigs();
    await deployment.restartLocalDeployment();
    await page.waitForTimeout(3000);
    await deployment.waitForDeploymentReady();

    // wait for rhdh first sync and portal to be reachable
    await deployment.waitForSynced();

    const login = await common.keycloakLogin(
      "zeus",
      process.env.DEFAULT_USER_PASSWORD,
    );
    expect(login).toBe("Login successful");

    await uiHelper.goToPageUrl("/settings", "Settings");
    await uiHelper.verifyHeading("Zeus Giove");
    await common.signOut();

    const login2 = await common.keycloakLogin(
      "atena",
      process.env.DEFAULT_USER_PASSWORD,
    );
    expect(login2).toBe("Login successful");
    await uiHelper.goToPageUrl("/settings", "Settings");
    await uiHelper.verifyHeading("Atena Minerva");
    await common.signOut();
  });

  test("Login with OIDC preferredUsernameMatchingUserEntityName resolver", async () => {
    await deployment.setOIDCResolver(
      "preferredUsernameMatchingUserEntityName",
      false,
    );
    await deployment.updateAllConfigs();
    await page.waitForTimeout(3000);
    await deployment.restartLocalDeployment();
    await deployment.waitForDeploymentReady();

    // wait for rhdh first sync and portal to be reachable
    await deployment.waitForSynced();

    const login = await common.keycloakLogin(
      "atena",
      process.env.DEFAULT_USER_PASSWORD,
    );
    expect(login).toBe("Login successful");

    await uiHelper.goToPageUrl("/settings", "Settings");
    await uiHelper.verifyHeading("Atena Minerva");
    await common.signOut();
  });

  test(`Set sessionDuration and confirm in auth cookie duration has been set`, async () => {
    deployment.setAppConfigProperty(
      "auth.providers.oidc.production.sessionDuration",
      "3days",
    );
    await deployment.updateAllConfigs();
    await deployment.restartLocalDeployment();
    await deployment.waitForDeploymentReady();

    // wait for rhdh first sync and portal to be reachable
    await deployment.waitForSynced();

    const login = await common.keycloakLogin(
      "zeus",
      process.env.DEFAULT_USER_PASSWORD,
    );
    expect(login).toBe("Login successful");

    await page.reload();

    const cookies = await context.cookies();
    const authCookie = cookies.find(
      (cookie) => cookie.name === "oidc-refresh-token",
    );

    const threeDays = 3 * 24 * 60 * 60 * 1000; // expected duration of 3 days in ms
    const tolerance = 3 * 60 * 1000; // allow for 3 minutes tolerance

    const actualDuration = authCookie.expires * 1000 - Date.now();

    expect(actualDuration).toBeGreaterThan(threeDays - tolerance);
    expect(actualDuration).toBeLessThan(threeDays + tolerance);

    await uiHelper.goToPageUrl("/settings", "Settings");
    await uiHelper.verifyHeading("Zeus Giove");
    await common.signOut();
  });

  test(`Ingestion of users and groups: verify the user entities and groups are created with the correct relationships`, async () => {
    expect(
      await deployment.checkUserIsIngestedInCatalog([
        "Admin E2e",
        "Atena Minerva",
        "Elio Sole",
        "Tyke Fortuna",
        "Zeus Giove",
      ]),
    ).toBe(true);
    expect(
      await deployment.checkGroupIsIngestedInCatalog([
        "admins",
        "goddesses",
        "gods",
      ]),
    ).toBe(true);
    expect(await deployment.checkUserIsInGroup("admin", "admins")).toBe(true);
    expect(await deployment.checkUserIsInGroup("zeus", "admins")).toBe(true);
    expect(await deployment.checkUserIsInGroup("atena", "goddesses")).toBe(
      true,
    );
    expect(await deployment.checkUserIsInGroup("tyke", "goddesses")).toBe(true);
    expect(await deployment.checkUserIsInGroup("elio", "gods")).toBe(true);
    expect(await deployment.checkUserIsInGroup("zeus", "gods")).toBe(true);

    expect(await deployment.checkGroupIsChildOfGroup("gods", "all")).toBe(true);
    expect(await deployment.checkGroupIsChildOfGroup("goddesses", "all")).toBe(
      true,
    );
    expect(await deployment.checkGroupIsParentOfGroup("all", "gods")).toBe(
      true,
    );
    expect(await deployment.checkGroupIsParentOfGroup("all", "goddesses")).toBe(
      true,
    );
  });

  test(`Ingestion of users and groups with invalid characters: check sanitize[User/Group]NameTransformer`, async () => {
    expect(
      await deployment.checkUserIsIngestedInCatalog(["Invalid Username"]),
    ).toBe(true);
    expect(
      await deployment.checkGroupIsIngestedInCatalog(["invalid@groupname"]),
    ).toBe(true);
  });

  test("Ensure Guest login is disabled when setting environment to production", async () => {
    await uiHelper.goToPageUrl("/", "Select a sign-in method");
    const singInMethods = await page
      .locator("div[class^='MuiCardHeader-root']")
      .allInnerTexts();
    expect(singInMethods).not.toContain("Guest");
  });

  test("Login with OIDC as primary sign in provider and GitHub auth as secondary", async () => {
    const oidcLogin = await common.keycloakLogin(
      "zeus",
      process.env.DEFAULT_USER_PASSWORD,
    );

    expect(oidcLogin).toBe("Login successful");

    await uiHelper.goToPageUrl("/settings", "Settings");
    await uiHelper.verifyHeading("Zeus Giove");

    expect(process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_ID).toBeDefined();
    // set up GitHub auth
    deployment.setAppConfigProperty("auth.providers.github", {
      production: {
        clientId: "${AUTH_PROVIDERS_GH_ORG_CLIENT_ID}",
        clientSecret: "${AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET}",
        callbackUrl:
          "${BASE_URL:-http://localhost:7007}/api/auth/github/handler/frame",
      },
    });

    deployment.setAppConfigProperty(
      "auth.providers.github.production.disableIdentityResolution",
      "true",
    );
    await deployment.updateAllConfigs();
    await deployment.restartLocalDeployment();
    await page.waitForTimeout(3000);
    await deployment.waitForDeploymentReady();

    // wait for rhdh first sync and portal to be reachable
    await deployment.waitForSynced();

    const ghLogin = await common.githubLoginFromSettingsPage(
      "rhdhqeauth1",
      process.env.AUTH_PROVIDERS_GH_USER_PASSWORD,
      process.env.AUTH_PROVIDERS_GH_USER_2FA,
    );
    expect(ghLogin).toBe("Login successful");
    // Sign out for GitHub
    await page.getByTitle("Sign out from GitHub").click();

    // Sign out for OIDC
    await uiHelper.goToPageUrl("/settings", "Settings");
    await uiHelper.verifyHeading("Zeus Giove");
    await common.signOut();
    await context.clearCookies();
  });

  test.afterAll(async () => {
    console.log("[TEST] Starting cleanup...");
    await deployment.killRunningProcess();
    console.log("[TEST] Cleanup completed");
  });
});
