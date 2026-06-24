import { test, expect, Page, BrowserContext } from "@support/coverage/test";

import { AuthProviderHarness } from "../../support/fixtures/auth-provider-harness";
import { SettingsPage } from "../../support/pages/settings-page";
import { Common } from "../../utils/common";
import { NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE } from "../../utils/constants";

/* SUPORTED RESOLVERS
GITHUB:
    [x] userIdMatchingUserEntityAnnotation -> (Default >=1.10.x)
    [x] usernameMatchingUserEntityName -> (Default <=1.9.x)
    [x] emailMatchingUserEntityProfileEmail
    [x] emailLocalPartMatchingUserEntityName
*/

const harness = await AuthProviderHarness.create("albarbaro-test-namespace-github");

test.describe("Configure Github Provider", () => {
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
      "AUTH_PROVIDERS_GH_ORG_NAME",
      "AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET",
      "AUTH_PROVIDERS_GH_ORG_CLIENT_ID",
      "AUTH_PROVIDERS_GH_USER_PASSWORD",
      "AUTH_PROVIDERS_GH_USER_2FA",
      "AUTH_PROVIDERS_GH_ADMIN_2FA",
      "AUTH_PROVIDERS_GH_ORG_APP_ID",
      "AUTH_PROVIDERS_GH_ORG1_PRIVATE_KEY",
      "AUTH_PROVIDERS_GH_ORG_WEBHOOK_SECRET",
    ]);

    await harness.loadConfigsAndProvisionNamespace();
    await harness.addBaseUrlSecretsIfRemote();
    await harness.addSecretsFromEnv({
      AUTH_PROVIDERS_GH_ORG_NAME: "AUTH_PROVIDERS_GH_ORG_NAME",
      AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET: "AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET",
      AUTH_PROVIDERS_GH_ORG_CLIENT_ID: "AUTH_PROVIDERS_GH_ORG_CLIENT_ID",
      AUTH_PROVIDERS_GH_ORG_APP_ID: "AUTH_PROVIDERS_GH_ORG_APP_ID",
      AUTH_PROVIDERS_GH_ORG1_PRIVATE_KEY: "AUTH_PROVIDERS_GH_ORG1_PRIVATE_KEY",
      AUTH_PROVIDERS_GH_ORG_WEBHOOK_SECRET: "AUTH_PROVIDERS_GH_ORG_WEBHOOK_SECRET",
    });
    await harness.createSecret();

    console.log("[TEST] Enabling GitHub login with ingestion...");
    await harness.deployment.enableGithubLoginWithIngestion();
    await harness.deployment.updateAllConfigs();
    console.log("[TEST] GitHub login with ingestion enabled successfully");

    await harness.deployAndWait();
  });

  test.beforeEach(() => {
    console.log(`Running test case ${test.info().title} - Attempt #${test.info().retry}`);
  });

  test("Login with Github default resolver", async () => {
    const login = await common.githubLogin(
      "rhdhqeauthadmin",
      process.env.AUTH_PROVIDERS_GH_USER_PASSWORD!,
      process.env.AUTH_PROVIDERS_GH_ADMIN_2FA!,
    );
    expect(login).toBe("Login successful");

    await settingsPage.open();
    await settingsPage.verifyProfileHeading("RHDH QE Admin");
    await common.signOut();
    await context.clearCookies();
  });

  test("Login with Github usernameMatchingUserEntityName resolver", async () => {
    //A github sign-in resolver that looks up the user using their github username as the entity name.
    await harness.deployment.setGithubResolver("usernameMatchingUserEntityName", false);
    await harness.reconcileAfterConfigChange();

    const login = await common.githubLogin(
      "rhdhqeauthadmin",
      process.env.AUTH_PROVIDERS_GH_USER_PASSWORD!,
      process.env.AUTH_PROVIDERS_GH_ADMIN_2FA!,
    );
    expect(login).toBe("Login successful");

    await settingsPage.open();
    await settingsPage.verifyProfileHeading("RHDH QE Admin");
    await common.signOut();
    await context.clearCookies();
  });

  test("Login with Github emailMatchingUserEntityProfileEmail resolver", async () => {
    //A common sign-in resolver that looks up the user using the local part of their email address as the entity name.
    await harness.deployment.setGithubResolver("emailMatchingUserEntityProfileEmail", false);
    await harness.reconcileAfterConfigChange();

    const login = await common.githubLogin(
      "rhdhqeauth1",
      process.env.AUTH_PROVIDERS_GH_USER_PASSWORD!,
      process.env.AUTH_PROVIDERS_GH_USER_2FA!,
    );
    expect(login).toBe("Login successful");

    await settingsPage.verifySignInError(NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE);
    await context.clearCookies();
  });

  test("Login with Github emailLocalPartMatchingUserEntityName resolver", async () => {
    //A common sign-in resolver that looks up the user using the local part of their email address as the entity name.
    await harness.deployment.setGithubResolver("emailLocalPartMatchingUserEntityName", false);
    await harness.reconcileAfterConfigChange();

    const login = await common.githubLogin(
      "rhdhqeauth1",
      process.env.AUTH_PROVIDERS_GH_USER_PASSWORD!,
      process.env.AUTH_PROVIDERS_GH_USER_2FA!,
    );

    // Login failed; caused by Error: Login failed, user profile does not contain an email

    expect(login).toBe("Login successful");

    await settingsPage.verifySignInError(NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE);
    await context.clearCookies();
  });

  test(`Set Github sessionDuration and confirm in auth cookie duration has been set`, async () => {
    harness.deployment.setAppConfigProperty(
      "auth.providers.github.production.sessionDuration",
      "3days",
    );
    await harness.reconcileAfterConfigChange();

    const login = await common.githubLogin(
      "rhdhqeauthadmin",
      process.env.AUTH_PROVIDERS_GH_USER_PASSWORD!,
      process.env.AUTH_PROVIDERS_GH_ADMIN_2FA!,
    );
    expect(login).toBe("Login successful");

    await page.reload();

    const cookies = await context.cookies();
    const authCookie = cookies.find((cookie) => cookie.name === "github-refresh-token");
    expect(authCookie).toBeDefined();

    // expected duration of 3 days in ms
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    // allow for 3 minutes tolerance
    const tolerance = 3 * 60 * 1000;

    const actualDuration = authCookie!.expires * 1000 - Date.now();

    expect(actualDuration).toBeGreaterThan(threeDays - tolerance);
    expect(actualDuration).toBeLessThan(threeDays + tolerance);

    await settingsPage.open();
    await settingsPage.verifyProfileHeading("RHDH QE Admin");
    await common.signOut();
    await context.clearCookies();
  });

  test(`Ingestion of Github users and groups: verify the user entities and groups are created with the correct relationships`, async () => {
    await expect
      .poll(
        () => harness.deployment.checkUserIsIngestedInCatalog(["RHDH QE User 1", "RHDH QE Admin"]),
        { timeout: 120_000 },
      )
      .toBe(true);
    expect(
      await harness.deployment.checkGroupIsIngestedInCatalog([
        "test_admins",
        "test_all",
        "test_users",
      ]),
    ).toBe(true);
    expect(await harness.deployment.checkUserIsInGroup("rhdhqeauthadmin", "test_admins")).toBe(
      true,
    );
    expect(await harness.deployment.checkUserIsInGroup("rhdhqeauth1", "test_users")).toBe(true);

    expect(await harness.deployment.checkGroupIsChildOfGroup("test_users", "test_all")).toBe(true);
    expect(await harness.deployment.checkGroupIsChildOfGroup("test_admins", "test_all")).toBe(true);

    expect(
      await harness.deployment.checkUserHasAnnotation(
        "rhdhqeauthadmin",
        "MY_CUSTOM_ANNOTATION",
        "rhdhqeauthadmin",
      ),
    ).toBe(true);
    expect(
      await harness.deployment.checkUserHasAnnotation(
        "rhdhqeauth1",
        "MY_CUSTOM_ANNOTATION",
        "rhdhqeauth1",
      ),
    ).toBe(true);
  });

  test("Login with Github as only auth provider with disableIdentityResolution should fail", async () => {
    harness.deployment.setAppConfigProperty(
      "auth.providers.github.production.disableIdentityResolution",
      "true",
    );
    await harness.reconcileAfterConfigChange();

    const login = await common.githubLogin(
      "rhdhqeauth1",
      process.env.AUTH_PROVIDERS_GH_USER_PASSWORD!,
      process.env.AUTH_PROVIDERS_GH_USER_2FA!,
    );

    expect(login).toBe("Login successful");

    await settingsPage.verifySignInError(
      /Login failed; caused by Error: The GitHub provider is not configured to support sign-in/u,
    );
    await context.clearCookies();
  });

  test.afterAll(async () => {
    await harness.cleanup();
  });
});
