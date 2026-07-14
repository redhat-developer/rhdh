import { test, expect, type Page, type BrowserContext } from "@support/coverage/test";

import type { LoginOutcome } from "../../support/auth/app-shell";
import { AuthProviderSession } from "../../support/auth/provider-auth";
import { createAuthProviderHarness } from "../../support/fixtures/auth-provider-playwright";
import { SettingsPage } from "../../support/pages/settings-page";
import {
  THREE_DAYS_MS,
  isRefreshTokenDurationNear,
} from "../../utils/authentication-providers/auth-cookie-duration";
import { MSClient } from "../../utils/authentication-providers/msgraph-helper";
import { NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE } from "../../utils/constants";

/* SUPPORTED RESOLVERS
MICOROSFT:
    [x] userIdMatchingUserEntityAnnotation -> (Default)
    [x] emailMatchingUserEntityAnnotation
    [x] emailMatchingUserEntityProfileEmail -> email will always match, just making sure it logs in
    [-] emailLocalPartMatchingUserEntityName
*/

const harness = createAuthProviderHarness("albarbaro-test-namespace-msgraph");

test.describe("Configure Microsoft Provider", () => {
  let authSession: AuthProviderSession;
  let settingsPage: SettingsPage;
  let page: Page;
  let context: BrowserContext;

  async function clearSession(): Promise<void> {
    await authSession.clearAuthState(context);
  }

  function loginAsZeus(): Promise<LoginOutcome> {
    return authSession.loginWithMicrosoftAzure(
      "zeus@rhdhtesting.onmicrosoft.com",
      process.env.DEFAULT_USER_PASSWORD_2!,
    );
  }

  function loginAsAtena(): Promise<LoginOutcome> {
    return authSession.loginWithMicrosoftAzure(
      "atena@rhdhtesting.onmicrosoft.com",
      process.env.DEFAULT_USER_PASSWORD_2!,
    );
  }

  function loginAsTyke(): Promise<LoginOutcome> {
    return authSession.loginWithMicrosoftAzure(
      "tyke@rhdhtesting.onmicrosoft.com",
      process.env.DEFAULT_USER_PASSWORD_2!,
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
        "DEFAULT_USER_PASSWORD_2",
        "AUTH_PROVIDERS_AZURE_CLIENT_ID",
        "AUTH_PROVIDERS_AZURE_CLIENT_SECRET",
        "AUTH_PROVIDERS_AZURE_TENANT_ID",
      ],
      envSecrets: {
        DEFAULT_USER_PASSWORD: "DEFAULT_USER_PASSWORD",
        DEFAULT_USER_PASSWORD_2: "DEFAULT_USER_PASSWORD_2",
        AUTH_PROVIDERS_AZURE_CLIENT_ID: "AUTH_PROVIDERS_AZURE_CLIENT_ID",
        AUTH_PROVIDERS_AZURE_CLIENT_SECRET: "AUTH_PROVIDERS_AZURE_CLIENT_SECRET",
        AUTH_PROVIDERS_AZURE_TENANT_ID: "AUTH_PROVIDERS_AZURE_TENANT_ID",
        MICROSOFT_CLIENT_ID: "AUTH_PROVIDERS_AZURE_CLIENT_ID",
        MICROSOFT_CLIENT_SECRET: "AUTH_PROVIDERS_AZURE_CLIENT_SECRET",
        MICROSOFT_TENANT_ID: "AUTH_PROVIDERS_AZURE_TENANT_ID",
      },
      enableProvider: async (deployment) => {
        await deployment.enableMicrosoftLoginWithIngestion();
      },
      beforeDeploy: async () => {
        console.log("[TEST] Configuring Microsoft Azure App Registration...");
        const graphClient = new MSClient(
          process.env.AUTH_PROVIDERS_AZURE_CLIENT_ID!,
          process.env.AUTH_PROVIDERS_AZURE_CLIENT_SECRET!,
          process.env.AUTH_PROVIDERS_AZURE_TENANT_ID!,
        );
        const redirectUrl = `${harness.backstageUrl}/api/auth/microsoft/handler/frame`;
        console.log(`[TEST] Adding redirect URL: ${redirectUrl}`);
        await graphClient.addAppRedirectUrlsAsync([redirectUrl]);
        console.log("[TEST] Microsoft Azure App Registration configured successfully");
      },
    });
  });

  test.beforeEach(() => {
    console.log(`Running test case ${test.info().title} - Attempt #${test.info().retry}`);
  });

  test("Login with Microsoft default resolver", async () => {
    await harness.runLoginCase({
      login: loginAsZeus,
      assert: async () => {
        await settingsPage.open();
        await settingsPage.verifyProfileHeading("TEST Zeus");
        await settingsPage.signOut();
      },
      cleanup: clearSession,
    });
  });

  test("Login with Microsoft emailMatchingUserEntityAnnotation resolver", async () => {
    await harness.runLoginCase({
      configure: async () => {
        await harness.deployment.setMicrosoftResolver("emailMatchingUserEntityAnnotation", false);
        await harness.reconcileAfterConfigChange();
      },
      login: loginAsZeus,
      assert: async () => {
        await settingsPage.open();
        await settingsPage.verifyProfileHeading("TEST Zeus");
        await settingsPage.signOut();
      },
      cleanup: clearSession,
    });

    await harness.runLoginCase({
      login: loginAsAtena,
      expectedResult: "error",
      assert: async () => {
        await settingsPage.verifySignInError(NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE);
      },
      cleanup: clearSession,
    });
  });

  test("Login with Microsoft emailMatchingUserEntityProfileEmail resolver", async () => {
    await harness.runLoginCase({
      configure: async () => {
        await harness.deployment.setMicrosoftResolver("emailMatchingUserEntityProfileEmail", false);
        await harness.reconcileAfterConfigChange();
      },
      login: loginAsZeus,
      assert: async () => {
        await settingsPage.open();
        await settingsPage.verifyProfileHeading("TEST Zeus");
        await settingsPage.signOut();
      },
      cleanup: clearSession,
    });
  });

  // NOTE: entity name is "name": "zeus_rhdhtesting.onmicrosoft.com", email is "email": "zeus@rhdhtesting.onmicrosoft.com" not resolving?
  test.fixme("Login with Microsoft emailLocalPartMatchingUserEntityName resolver", async () => {
    await harness.runLoginCase({
      configure: async () => {
        await harness.deployment.setMicrosoftResolver(
          "emailLocalPartMatchingUserEntityName",
          false,
        );
        await harness.reconcileAfterConfigChange();
      },
      login: loginAsZeus,
      assert: async () => {
        await settingsPage.open();
        await settingsPage.verifyProfileHeading("TEST Zeus");
        await settingsPage.signOut();
      },
      cleanup: clearSession,
    });

    await harness.runLoginCase({
      login: loginAsTyke,
      expectedResult: "error",
      assert: async () => {
        await settingsPage.verifySignInError(NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE);
      },
      cleanup: clearSession,
    });
  });

  test(`Set Microsoft sessionDuration and confirm auth cookie duration has been set`, async () => {
    await harness.runLoginCase({
      configure: async () => {
        harness.deployment.configureMicrosoftSessionDuration("3days");
        await harness.reconcileAfterConfigChange();
      },
      login: loginAsZeus,
      assert: async () => {
        await page.reload();

        const cookies = await context.cookies();
        const authCookie = cookies.find((cookie) => cookie.name === "microsoft-refresh-token");
        expect(isRefreshTokenDurationNear(authCookie, THREE_DAYS_MS)).toBe(true);

        await settingsPage.open();
        await settingsPage.verifyProfileHeading("TEST Zeus");
        await settingsPage.signOut();
      },
      cleanup: clearSession,
    });
  });

  test(`Ingestion of Microsoft users and groups: verify the user entities and groups are created with the correct relationships`, async () => {
    await expect
      .poll(
        () =>
          harness.deployment.checkUserIsIngestedInCatalog([
            "TEST Admin",
            "TEST Atena",
            "TEST Elio",
            "TEST Tyke",
            "TEST Zeus",
          ]),
        { timeout: 120_000 },
      )
      .toBe(true);
    expect(
      await harness.deployment.checkGroupIsIngestedInCatalog([
        "TEST_admins",
        "TEST_goddesses",
        "TEST_gods",
        "TEST_all",
      ]),
    ).toBe(true);
    expect(
      await harness.deployment.checkUserIsInGroup(
        "admin_rhdhtesting.onmicrosoft.com",
        "TEST_admins",
      ),
    ).toBe(true);
    expect(
      await harness.deployment.checkUserIsInGroup(
        "zeus_rhdhtesting.onmicrosoft.com",
        "TEST_admins",
      ),
    ).toBe(true);
    expect(
      await harness.deployment.checkUserIsInGroup(
        "atena_rhdhtesting.onmicrosoft.com",
        "TEST_goddesses",
      ),
    ).toBe(true);
    expect(
      await harness.deployment.checkUserIsInGroup(
        "tiche_rhdhtesting.onmicrosoft.com",
        "TEST_goddesses",
      ),
    ).toBe(true);
    expect(
      await harness.deployment.checkUserIsInGroup("elio_rhdhtesting.onmicrosoft.com", "TEST_gods"),
    ).toBe(true);
    expect(
      await harness.deployment.checkUserIsInGroup("zeus_rhdhtesting.onmicrosoft.com", "TEST_gods"),
    ).toBe(true);

    //expect(await harness.deployment.checkUserIsInGroup('zeus', 'all')).toBe(true);
    //expect(await harness.deployment.checkUserIsInGroup('tyke', 'all')).toBe(true);
    expect(await harness.deployment.checkGroupIsChildOfGroup("test_gods", "test_all")).toBe(true);
    expect(await harness.deployment.checkGroupIsChildOfGroup("test_goddesses", "test_all")).toBe(
      true,
    );
    expect(await harness.deployment.checkGroupIsParentOfGroup("test_all", "test_gods")).toBe(true);
    expect(await harness.deployment.checkGroupIsParentOfGroup("test_all", "test_goddesses")).toBe(
      true,
    );
  });

  test.afterAll(async () => {
    // Keep the Azure redirect URI registered. The albarbaro-* hostnames are
    // intentionally stable for this suite; removing mid-job races with retries
    // and Graph API eventual consistency (AADSTS50011).
    await harness.cleanup();
  });
});
