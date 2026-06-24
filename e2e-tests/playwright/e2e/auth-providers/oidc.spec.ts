import { test, expect, Page, BrowserContext } from "@support/coverage/test";

import { AuthProviderHarness } from "../../support/fixtures/auth-provider-harness";
import { SettingsPage } from "../../support/pages/settings-page";
import { KeycloakHelper } from "../../utils/authentication-providers/keycloak-helper";
import { Common } from "../../utils/common";
import { NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE } from "../../utils/constants";

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

const harness = await AuthProviderHarness.create("albarbaro-test-namespace-oidc");

const keycloakHelper = new KeycloakHelper({
  baseUrl: process.env.RHBK_BASE_URL!,
  realmName: process.env.RHBK_REALM!,
  clientId: process.env.RHBK_CLIENT_ID!,
  clientSecret: process.env.RHBK_CLIENT_SECRET!,
});

test.describe("Configure OIDC provider (using RHBK)", () => {
  test.use({ baseURL: harness.backstageUrl });

  let common: Common;
  let settingsPage: SettingsPage;
  let page: Page;
  let context: BrowserContext;

  test.beforeAll(async ({ rhdhPage, rhdhContext }) => {
    test.info().annotations.push({
      type: "component",
      description: "authentication",
    });

    page = rhdhPage;
    context = rhdhContext;
    common = new Common(rhdhPage);
    settingsPage = new SettingsPage(rhdhPage);

    harness.expectEnvVars([
      "DEFAULT_USER_PASSWORD",
      "RHBK_BASE_URL",
      "RHBK_REALM",
      "RHBK_CLIENT_ID",
      "RHBK_CLIENT_SECRET",
    ]);

    console.log("[TEST] Initializing Keycloak helper...");
    await keycloakHelper.initialize();
    console.log("[TEST] Keycloak helper initialized successfully");

    await harness.loadConfigsAndProvisionNamespace();
    await harness.addBaseUrlSecretsIfRemote();
    await harness.addSecretsFromEnv({
      DEFAULT_USER_PASSWORD: "DEFAULT_USER_PASSWORD",
      DEFAULT_USER_PASSWORD_2: "DEFAULT_USER_PASSWORD_2",
      RHBK_BASE_URL: "RHBK_BASE_URL",
      RHBK_REALM: "RHBK_REALM",
      RHBK_CLIENT_ID: "RHBK_CLIENT_ID",
      RHBK_CLIENT_SECRET: "RHBK_CLIENT_SECRET",
      AUTH_PROVIDERS_GH_ORG_CLIENT_ID: "AUTH_PROVIDERS_GH_ORG_CLIENT_ID",
      AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET: "AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET",
    });
    await harness.createSecret();

    console.log("[TEST] Enabling OIDC login with ingestion...");
    await harness.deployment.enableOIDCLoginWithIngestion();
    await harness.deployment.updateAllConfigs();
    console.log("[TEST] OIDC login with ingestion enabled successfully");

    await harness.deployAndWait();
  });

  test.beforeEach(() => {
    console.log(`Running test case ${test.info().title} - Attempt #${test.info().retry}`);
  });

  test("Login with OIDC default resolver", async () => {
    const login = await common.keycloakLogin("zeus", process.env.DEFAULT_USER_PASSWORD!);
    expect(login).toBe("Login successful");

    await settingsPage.open();
    await settingsPage.verifyProfileHeading("Zeus Giove");

    await settingsPage.hideQuickstartIfVisible();

    await settingsPage.verifyRhdhMetadata();

    await common.signOut();
  });

  test("Login with OIDC oidcSubClaimMatchingKeycloakUserId resolver", async () => {
    await harness.deployment.enableOIDCLoginWithIngestion();
    await harness.deployment.setOIDCResolver("oidcSubClaimMatchingKeycloakUserId", false);
    await harness.reconcileAfterConfigChange();

    const login = await common.keycloakLogin("zeus", process.env.DEFAULT_USER_PASSWORD!);
    expect(login).toBe("Login successful");

    await settingsPage.open();
    await settingsPage.verifyProfileHeading("Zeus Giove");
    await common.signOut();
  });

  test("Login with OIDC emailMatchingUserEntityProfileEmail resolver", async () => {
    await harness.deployment.setOIDCResolver("emailMatchingUserEntityProfileEmail", false);
    await harness.reconcileAfterConfigChange();

    const login = await common.keycloakLogin("zeus", process.env.DEFAULT_USER_PASSWORD!);
    expect(login).toBe("Login successful");

    await settingsPage.open();
    await settingsPage.verifyProfileHeading("Zeus Giove");
    await common.signOut();
  });

  test("Login with OIDC emailLocalPartMatchingUserEntityName resolver", async () => {
    await harness.deployment.setOIDCResolver("emailLocalPartMatchingUserEntityName", false);
    await harness.reconcileAfterConfigChange();

    const login = await common.keycloakLogin("zeus", process.env.DEFAULT_USER_PASSWORD!);
    expect(login).toBe("Login successful");

    await settingsPage.open();
    await settingsPage.verifyProfileHeading("Zeus Giove");
    await common.signOut();

    const login2 = await common.keycloakLogin("atena", process.env.DEFAULT_USER_PASSWORD!);
    expect(login2).toBe("Login successful");

    await settingsPage.verifySignInError(NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE);
    await keycloakHelper.initialize();
    await keycloakHelper.clearUserSessions("atena");
  });

  test("Login with OIDC emailLocalPartMatchingUserEntityName with dangerouslyAllowSignInWithoutUserInCatalog resolver", async () => {
    await harness.deployment.setOIDCResolver("emailLocalPartMatchingUserEntityName", true);
    await harness.reconcileAfterConfigChange();

    const login = await common.keycloakLogin("zeus", process.env.DEFAULT_USER_PASSWORD!);
    expect(login).toBe("Login successful");

    await settingsPage.open();
    await settingsPage.verifyProfileHeading("Zeus Giove");
    await common.signOut();

    const login2 = await common.keycloakLogin("atena", process.env.DEFAULT_USER_PASSWORD!);
    expect(login2).toBe("Login successful");
    await settingsPage.open();
    await settingsPage.verifyProfileHeading("Atena Minerva");
    await common.signOut();
  });

  test("Login with OIDC preferredUsernameMatchingUserEntityName resolver", async () => {
    await harness.deployment.setOIDCResolver("preferredUsernameMatchingUserEntityName", false);
    await harness.reconcileAfterConfigChange();

    const login = await common.keycloakLogin("atena", process.env.DEFAULT_USER_PASSWORD!);
    expect(login).toBe("Login successful");

    await settingsPage.open();
    await settingsPage.verifyProfileHeading("Atena Minerva");
    await common.signOut();
  });

  test(`Set sessionDuration and confirm in auth cookie duration has been set`, async () => {
    harness.deployment.setAppConfigProperty(
      "auth.providers.oidc.production.sessionDuration",
      "3days",
    );
    await harness.reconcileAfterConfigChange();

    const login = await common.keycloakLogin("zeus", process.env.DEFAULT_USER_PASSWORD!);
    expect(login).toBe("Login successful");

    await page.reload();

    const cookies = await context.cookies();
    const authCookie = cookies.find((cookie) => cookie.name === "oidc-refresh-token");
    expect(authCookie).toBeDefined();

    // expected duration of 3 days in ms
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    // allow for 3 minutes tolerance
    const tolerance = 3 * 60 * 1000;

    const actualDuration = authCookie!.expires * 1000 - Date.now();

    expect(actualDuration).toBeGreaterThan(threeDays - tolerance);
    expect(actualDuration).toBeLessThan(threeDays + tolerance);

    await settingsPage.open();
    await settingsPage.verifyProfileHeading("Zeus Giove");
    await common.signOut();
  });

  test(`Ingestion of users and groups: verify the user entities and groups are created with the correct relationships`, async () => {
    expect(
      await harness.deployment.checkUserIsIngestedInCatalog([
        "Admin E2e",
        "Atena Minerva",
        "Elio Sole",
        "Tyke Fortuna",
        "Zeus Giove",
      ]),
    ).toBe(true);
    expect(
      await harness.deployment.checkGroupIsIngestedInCatalog(["admins", "goddesses", "gods"]),
    ).toBe(true);
    expect(await harness.deployment.checkUserIsInGroup("admin", "admins")).toBe(true);
    expect(await harness.deployment.checkUserIsInGroup("zeus", "admins")).toBe(true);
    expect(await harness.deployment.checkUserIsInGroup("atena", "goddesses")).toBe(true);
    expect(await harness.deployment.checkUserIsInGroup("tyke", "goddesses")).toBe(true);
    expect(await harness.deployment.checkUserIsInGroup("elio", "gods")).toBe(true);
    expect(await harness.deployment.checkUserIsInGroup("zeus", "gods")).toBe(true);

    expect(await harness.deployment.checkGroupIsChildOfGroup("gods", "all")).toBe(true);
    expect(await harness.deployment.checkGroupIsChildOfGroup("goddesses", "all")).toBe(true);
    expect(await harness.deployment.checkGroupIsParentOfGroup("all", "gods")).toBe(true);
    expect(await harness.deployment.checkGroupIsParentOfGroup("all", "goddesses")).toBe(true);
  });

  test(`Ingestion of users and groups with invalid characters: check sanitize[User/Group]NameTransformer`, async () => {
    expect(await harness.deployment.checkUserIsIngestedInCatalog(["Invalid Username"])).toBe(true);
    expect(await harness.deployment.checkGroupIsIngestedInCatalog(["invalid@groupname"])).toBe(
      true,
    );
  });

  test("Ensure Guest login is disabled when setting environment to production", async () => {
    await settingsPage.goToPageUrl("/", "Select a sign-in method");
    await settingsPage.verifyGuestSignInMethodNotListed();
  });

  test("Login with OIDC as primary sign in provider and GitHub auth as secondary", async () => {
    const oidcLogin = await common.keycloakLogin("zeus", process.env.DEFAULT_USER_PASSWORD!);

    expect(oidcLogin).toBe("Login successful");

    await settingsPage.open();
    await settingsPage.verifyProfileHeading("Zeus Giove");

    expect(process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET!).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_ID!).toBeDefined();
    // set up GitHub auth
    harness.deployment.setAppConfigProperty("auth.providers.github", {
      production: {
        clientId: "${AUTH_PROVIDERS_GH_ORG_CLIENT_ID}",
        clientSecret: "${AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET}",
        callbackUrl: "${BASE_URL:-http://localhost:7007}/api/auth/github/handler/frame",
      },
    });

    harness.deployment.setAppConfigProperty(
      "auth.providers.github.production.disableIdentityResolution",
      "true",
    );
    await harness.reconcileAfterConfigChange();

    await settingsPage.hideQuickstartIfVisible();

    const ghLogin = await common.githubLoginFromSettingsPage(
      "rhdhqeauth1",
      process.env.AUTH_PROVIDERS_GH_USER_PASSWORD!,
      process.env.AUTH_PROVIDERS_GH_USER_2FA!,
    );
    expect(ghLogin).toBe("Login successful");
    // Sign out for GitHub
    await page.getByTitle("Sign out from GitHub").click();

    // Sign out for OIDC
    await settingsPage.open();
    await settingsPage.verifyProfileHeading("Zeus Giove");
    await common.signOut();
    await context.clearCookies();
  });

  test(`Enable autologout and user is logged out after inactivity`, async () => {
    harness.deployment.setAppConfigProperty("auth.autologout.enabled", "true");
    // minimum allowed value is 0.5 minutes
    harness.deployment.setAppConfigProperty("auth.autologout.idleTimeoutMinutes", 0.5);
    harness.deployment.setAppConfigProperty("auth.autologout.promptBeforeIdleSeconds", 5);
    await harness.reconcileAfterConfigChange();

    const login = await common.keycloakLogin("zeus", process.env.DEFAULT_USER_PASSWORD!);
    expect(login).toBe("Login successful");

    await settingsPage.verifyTextVisible("Logging out due to inactivity", false, 60000);
    await settingsPage.verifyInactivityLogoutMessageHidden();

    await page.reload();

    const cookies = await context.cookies();
    const authCookie = cookies.find((cookie) => cookie.name === "oidc-refresh-token");
    expect(authCookie).toBeUndefined();
  });

  test(`Enable autologout and user stays logged in after clicking "Don't log me out"`, async () => {
    harness.deployment.setAppConfigProperty("auth.autologout.enabled", "true");
    // minimum allowed value is 0.5 minutes
    harness.deployment.setAppConfigProperty("auth.autologout.idleTimeoutMinutes", 0.5);
    harness.deployment.setAppConfigProperty("auth.autologout.promptBeforeIdleSeconds", 5);
    await harness.reconcileAfterConfigChange();

    const login = await common.keycloakLogin("zeus", process.env.DEFAULT_USER_PASSWORD!);
    expect(login).toBe("Login successful");

    await settingsPage.clickButtonByText("Don't log me out", {
      timeout: 60000,
    });

    await settingsPage.open();
    await settingsPage.verifyProfileHeading("Zeus Giove");
    await common.signOut();
  });

  test.afterAll(async () => {
    await harness.cleanup();
  });
});
