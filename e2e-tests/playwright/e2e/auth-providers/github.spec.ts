import { test, expect, type Page, type BrowserContext } from "@support/coverage/test";

import { AuthProviderSession } from "../../support/auth/provider-auth";
import { AuthProviderHarness } from "../../support/fixtures/auth-provider-harness";
import { SettingsPage } from "../../support/pages/settings-page";
import { teardownBrowser } from "../../utils/common/browser";
import { NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE } from "../../utils/constants";

/* SUPORTED RESOLVERS
GITHUB:
    [x] userIdMatchingUserEntityAnnotation -> (Default >=1.10.x)
    [x] usernameMatchingUserEntityName -> (Default <=1.9.x)
    [x] emailMatchingUserEntityProfileEmail
    [x] emailLocalPartMatchingUserEntityName
*/

const harness = AuthProviderHarness.create("albarbaro-test-namespace-github");

test.describe("Configure Github Provider", () => {
  test.use({ baseURL: harness.backstageUrl });

  let authSession: AuthProviderSession;
  let settingsPage: SettingsPage;
  let page: Page;
  let context: BrowserContext;

  async function clearSession(): Promise<void> {
    await authSession.clearAuthState(context);
  }

  function loginAsGithubAdmin(): Promise<string> {
    return authSession.loginWithGitHub(
      "rhdhqeauthadmin",
      process.env.AUTH_PROVIDERS_GH_USER_PASSWORD!,
      process.env.AUTH_PROVIDERS_GH_ADMIN_2FA!,
    );
  }

  function loginAsGithubUser(): Promise<string> {
    return authSession.loginWithGitHub(
      "rhdhqeauth1",
      process.env.AUTH_PROVIDERS_GH_USER_PASSWORD!,
      process.env.AUTH_PROVIDERS_GH_USER_2FA!,
    );
  }

  test.beforeAll(async ({ rhdhPage, rhdhContext, rhdhAuthSession }) => {
    test.info().annotations.push({
      type: "component",
      description: "authentication",
    });

    page = rhdhPage;
    context = rhdhContext;
    authSession = rhdhAuthSession;
    settingsPage = new SettingsPage(rhdhPage);

    await harness.prepareProvider({
      requiredEnvVars: [
        "AUTH_PROVIDERS_GH_ORG_NAME",
        "AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET",
        "AUTH_PROVIDERS_GH_ORG_CLIENT_ID",
        "AUTH_PROVIDERS_GH_USER_PASSWORD",
        "AUTH_PROVIDERS_GH_USER_2FA",
        "AUTH_PROVIDERS_GH_ADMIN_2FA",
        "AUTH_PROVIDERS_GH_ORG_APP_ID",
        "AUTH_PROVIDERS_GH_ORG1_PRIVATE_KEY",
        "AUTH_PROVIDERS_GH_ORG_WEBHOOK_SECRET",
      ],
      envSecrets: {
        AUTH_PROVIDERS_GH_ORG_NAME: "AUTH_PROVIDERS_GH_ORG_NAME",
        AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET: "AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET",
        AUTH_PROVIDERS_GH_ORG_CLIENT_ID: "AUTH_PROVIDERS_GH_ORG_CLIENT_ID",
        AUTH_PROVIDERS_GH_ORG_APP_ID: "AUTH_PROVIDERS_GH_ORG_APP_ID",
        AUTH_PROVIDERS_GH_ORG1_PRIVATE_KEY: "AUTH_PROVIDERS_GH_ORG1_PRIVATE_KEY",
        AUTH_PROVIDERS_GH_ORG_WEBHOOK_SECRET: "AUTH_PROVIDERS_GH_ORG_WEBHOOK_SECRET",
      },
      enableProvider: async (deployment) => {
        console.log("[TEST] Enabling GitHub login with ingestion...");
        await deployment.enableGithubLoginWithIngestion();
        console.log("[TEST] GitHub login with ingestion enabled successfully");
      },
    });
  });

  test.beforeEach(() => {
    console.log(`Running test case ${test.info().title} - Attempt #${test.info().retry}`);
  });

  test("Login with Github default resolver", async () => {
    await harness.runLoginCase({
      login: loginAsGithubAdmin,
      assert: async () => {
        await settingsPage.open();
        await settingsPage.verifyProfileHeading("RHDH QE Admin");
        await settingsPage.signOut();
      },
      cleanup: clearSession,
    });
  });

  test("Login with Github usernameMatchingUserEntityName resolver", async () => {
    await harness.runLoginCase({
      configure: async () => {
        await harness.deployment.setGithubResolver("usernameMatchingUserEntityName", false);
        await harness.reconcileAfterConfigChange();
      },
      login: loginAsGithubAdmin,
      assert: async () => {
        await settingsPage.open();
        await settingsPage.verifyProfileHeading("RHDH QE Admin");
        await settingsPage.signOut();
      },
      cleanup: clearSession,
    });
  });

  test("Login with Github emailMatchingUserEntityProfileEmail resolver", async () => {
    await harness.runLoginCase({
      configure: async () => {
        await harness.deployment.setGithubResolver("emailMatchingUserEntityProfileEmail", false);
        await harness.reconcileAfterConfigChange();
      },
      login: loginAsGithubUser,
      assert: async () => {
        await settingsPage.verifySignInError(NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE);
      },
      cleanup: clearSession,
    });
  });

  test("Login with Github emailLocalPartMatchingUserEntityName resolver", async () => {
    await harness.runLoginCase({
      configure: async () => {
        await harness.deployment.setGithubResolver("emailLocalPartMatchingUserEntityName", false);
        await harness.reconcileAfterConfigChange();
      },
      login: loginAsGithubUser,
      assert: async () => {
        await settingsPage.verifySignInError(NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE);
      },
      cleanup: clearSession,
    });
  });

  test(`Set Github sessionDuration and confirm in auth cookie duration has been set`, async () => {
    await harness.runLoginCase({
      configure: async () => {
        harness.deployment.setAppConfigProperty(
          "auth.providers.github.production.sessionDuration",
          "3days",
        );
        await harness.reconcileAfterConfigChange();
      },
      login: loginAsGithubAdmin,
      assert: async () => {
        await page.reload();

        const cookies = await context.cookies();
        const authCookie = cookies.find((cookie) => cookie.name === "github-refresh-token");
        expect(authCookie).toBeDefined();

        const threeDays = 3 * 24 * 60 * 60 * 1000;
        const tolerance = 3 * 60 * 1000;
        const actualDuration = authCookie!.expires * 1000 - Date.now();

        expect(actualDuration).toBeGreaterThan(threeDays - tolerance);
        expect(actualDuration).toBeLessThan(threeDays + tolerance);

        await settingsPage.open();
        await settingsPage.verifyProfileHeading("RHDH QE Admin");
        await settingsPage.signOut();
      },
      cleanup: clearSession,
    });
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
    await harness.runLoginCase({
      configure: async () => {
        harness.deployment.setAppConfigProperty(
          "auth.providers.github.production.disableIdentityResolution",
          "true",
        );
        await harness.reconcileAfterConfigChange();
      },
      login: loginAsGithubUser,
      assert: async () => {
        await settingsPage.verifySignInError(
          /Login failed; caused by Error: The GitHub provider is not configured to support sign-in/u,
        );
      },
      cleanup: clearSession,
    });
  });

  test.afterAll(async ({ rhdhPage }, testInfo) => {
    await harness.cleanup();
    await teardownBrowser(rhdhPage, testInfo);
  });
});
