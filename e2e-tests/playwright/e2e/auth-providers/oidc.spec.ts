import { test, expect, type Page, type BrowserContext } from "@support/coverage/test";

import { AuthProviderSession } from "../../support/auth/provider-auth";
import { createAuthProviderHarness } from "../../support/fixtures/auth-provider-playwright";
import { SettingsPage } from "../../support/pages/settings-page";
import { KeycloakHelper } from "../../utils/authentication-providers/keycloak-helper";
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

const harness = createAuthProviderHarness("albarbaro-test-namespace-oidc");

const keycloakHelper = new KeycloakHelper({
  baseUrl: process.env.RHBK_BASE_URL!,
  realmName: process.env.RHBK_REALM!,
  clientId: process.env.RHBK_CLIENT_ID!,
  clientSecret: process.env.RHBK_CLIENT_SECRET!,
});

test.describe("Configure OIDC provider (using RHBK)", () => {
  let authSession: AuthProviderSession;
  let settingsPage: SettingsPage;
  let page: Page;
  let context: BrowserContext;

  async function clearSession(): Promise<void> {
    await authSession.clearAuthState(context);
  }

  function loginAsZeus(): Promise<string> {
    return authSession.loginWithKeycloak("zeus", process.env.DEFAULT_USER_PASSWORD!);
  }

  function loginAsAtena(): Promise<string> {
    return authSession.loginWithKeycloak("atena", process.env.DEFAULT_USER_PASSWORD!);
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

    console.log("[TEST] Initializing Keycloak helper...");
    await keycloakHelper.initialize();
    console.log("[TEST] Keycloak helper initialized successfully");

    await harness.prepareProvider({
      requiredEnvVars: [
        "DEFAULT_USER_PASSWORD",
        "RHBK_BASE_URL",
        "RHBK_REALM",
        "RHBK_CLIENT_ID",
        "RHBK_CLIENT_SECRET",
      ],
      envSecrets: {
        DEFAULT_USER_PASSWORD: "DEFAULT_USER_PASSWORD",
        DEFAULT_USER_PASSWORD_2: "DEFAULT_USER_PASSWORD_2",
        RHBK_BASE_URL: "RHBK_BASE_URL",
        RHBK_REALM: "RHBK_REALM",
        RHBK_CLIENT_ID: "RHBK_CLIENT_ID",
        RHBK_CLIENT_SECRET: "RHBK_CLIENT_SECRET",
        AUTH_PROVIDERS_GH_ORG_CLIENT_ID: "AUTH_PROVIDERS_GH_ORG_CLIENT_ID",
        AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET: "AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET",
      },
      enableProvider: async (deployment) => {
        console.log("[TEST] Enabling OIDC login with ingestion...");
        await deployment.enableOIDCLoginWithIngestion();
        console.log("[TEST] OIDC login with ingestion enabled successfully");
      },
    });
  });

  test.beforeEach(() => {
    console.log(`Running test case ${test.info().title} - Attempt #${test.info().retry}`);
  });

  test("Login with OIDC default resolver", async () => {
    await harness.runLoginCase({
      login: loginAsZeus,
      assert: async () => {
        await settingsPage.open();
        await settingsPage.verifyProfileHeading("Zeus Giove");
        await settingsPage.hideQuickstartIfVisible();
        await settingsPage.verifyRhdhMetadata();
        await settingsPage.signOut();
      },
      cleanup: clearSession,
    });
  });

  test("Login with OIDC oidcSubClaimMatchingKeycloakUserId resolver", async () => {
    await harness.runLoginCase({
      configure: async () => {
        await harness.deployment.enableOIDCLoginWithIngestion();
        await harness.deployment.setOIDCResolver("oidcSubClaimMatchingKeycloakUserId", false);
        await harness.reconcileAfterConfigChange();
      },
      login: loginAsZeus,
      assert: async () => {
        await settingsPage.open();
        await settingsPage.verifyProfileHeading("Zeus Giove");
        await settingsPage.signOut();
      },
      cleanup: clearSession,
    });
  });

  test("Login with OIDC emailMatchingUserEntityProfileEmail resolver", async () => {
    await harness.runLoginCase({
      configure: async () => {
        await harness.deployment.setOIDCResolver("emailMatchingUserEntityProfileEmail", false);
        await harness.reconcileAfterConfigChange();
      },
      login: loginAsZeus,
      assert: async () => {
        await settingsPage.open();
        await settingsPage.verifyProfileHeading("Zeus Giove");
        await settingsPage.signOut();
      },
      cleanup: clearSession,
    });
  });

  test("Login with OIDC emailLocalPartMatchingUserEntityName resolver", async () => {
    await harness.runLoginCase({
      configure: async () => {
        await harness.deployment.setOIDCResolver("emailLocalPartMatchingUserEntityName", false);
        await harness.reconcileAfterConfigChange();
      },
      login: loginAsZeus,
      assert: async () => {
        await settingsPage.open();
        await settingsPage.verifyProfileHeading("Zeus Giove");
        await settingsPage.signOut();
      },
      cleanup: clearSession,
    });

    await harness.runLoginCase({
      login: loginAsAtena,
      assert: async () => {
        await settingsPage.verifySignInError(NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE);
        await keycloakHelper.initialize();
        await keycloakHelper.clearUserSessions("atena");
      },
      cleanup: clearSession,
    });
  });

  test("Login with OIDC emailLocalPartMatchingUserEntityName with dangerouslyAllowSignInWithoutUserInCatalog resolver", async () => {
    await harness.runLoginCase({
      configure: async () => {
        await harness.deployment.setOIDCResolver("emailLocalPartMatchingUserEntityName", true);
        await harness.reconcileAfterConfigChange();
      },
      login: loginAsZeus,
      assert: async () => {
        await settingsPage.open();
        await settingsPage.verifyProfileHeading("Zeus Giove");
        await settingsPage.signOut();
      },
      cleanup: clearSession,
    });

    await harness.runLoginCase({
      login: loginAsAtena,
      assert: async () => {
        await settingsPage.open();
        await settingsPage.verifyProfileHeading("Atena Minerva");
        await settingsPage.signOut();
      },
      cleanup: clearSession,
    });
  });

  test("Login with OIDC preferredUsernameMatchingUserEntityName resolver", async () => {
    await harness.runLoginCase({
      configure: async () => {
        await harness.deployment.setOIDCResolver("preferredUsernameMatchingUserEntityName", false);
        await harness.reconcileAfterConfigChange();
      },
      login: loginAsAtena,
      assert: async () => {
        await settingsPage.open();
        await settingsPage.verifyProfileHeading("Atena Minerva");
        await settingsPage.signOut();
      },
      cleanup: clearSession,
    });
  });

  test(`Set OIDC cookieMaxAge and confirm auth cookie duration has been set`, async () => {
    await harness.runLoginCase({
      configure: async () => {
        harness.deployment.setAppConfigProperty(
          "auth.providers.oidc.production.cookieMaxAge",
          "3days",
        );
        await harness.reconcileAfterConfigChange();
      },
      login: loginAsZeus,
      assert: async () => {
        await page.reload();

        const cookies = await context.cookies();
        const authCookie = cookies.find((cookie) => cookie.name === "oidc-refresh-token");
        expect(authCookie).toBeDefined();

        const threeDays = 3 * 24 * 60 * 60 * 1000;
        const tolerance = 3 * 60 * 1000;
        const actualDuration = authCookie!.expires * 1000 - Date.now();

        expect(actualDuration).toBeGreaterThan(threeDays - tolerance);
        expect(actualDuration).toBeLessThan(threeDays + tolerance);

        await settingsPage.open();
        await settingsPage.verifyProfileHeading("Zeus Giove");
        await settingsPage.signOut();
      },
      cleanup: clearSession,
    });
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
    try {
      expect(process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET!).toBeDefined();
      expect(process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_ID!).toBeDefined();

      harness.deployment.setAppConfigProperty("auth.providers.github", {
        production: {
          clientId: "${AUTH_PROVIDERS_GH_ORG_CLIENT_ID}",
          clientSecret: "${AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET}",
          callbackUrl: "${BASE_URL:-http://localhost:7007}/api/auth/github/handler/frame",
          disableIdentityResolution: true,
        },
      });
      // Reconcile before primary login — restart drops the session, so OIDC
      // must happen after the GitHub secondary provider is already configured.
      await harness.reconcileAfterConfigChange();

      const result = await loginAsZeus();
      expect(result).toBe("Login successful");

      await settingsPage.open();
      await settingsPage.verifyProfileHeading("Zeus Giove");
      await settingsPage.hideQuickstartIfVisible();

      const ghLogin = await authSession.loginWithGitHubFromSettingsPage(
        "rhdhqeauth1",
        process.env.AUTH_PROVIDERS_GH_USER_PASSWORD!,
        process.env.AUTH_PROVIDERS_GH_USER_2FA!,
      );
      expect(ghLogin).toBe("Login successful");
      // Intentional divergence: GitHub provider settings expose sign-out via title tooltip.
      await page.getByTitle("Sign out from GitHub").click();

      await settingsPage.open();
      await settingsPage.verifyProfileHeading("Zeus Giove");
      await settingsPage.signOut();
    } finally {
      await clearSession();
    }
  });

  test(`Enable autologout and user is logged out after inactivity`, async () => {
    await harness.runLoginCase({
      configure: async () => {
        harness.deployment.setAppConfigProperty("auth.autologout.enabled", "true");
        harness.deployment.setAppConfigProperty("auth.autologout.idleTimeoutMinutes", 0.5);
        harness.deployment.setAppConfigProperty("auth.autologout.promptBeforeIdleSeconds", 5);
        await harness.reconcileAfterConfigChange();
      },
      login: loginAsZeus,
      assert: async () => {
        await settingsPage.verifyTextVisible("Logging out due to inactivity", false, 60000);
        await settingsPage.verifyInactivityLogoutMessageHidden();

        await page.reload();

        const cookies = await context.cookies();
        const authCookie = cookies.find((cookie) => cookie.name === "oidc-refresh-token");
        expect(authCookie).toBeUndefined();
      },
      cleanup: clearSession,
    });
  });

  test(`Enable autologout and user stays logged in after clicking "Don't log me out"`, async () => {
    await harness.runLoginCase({
      configure: async () => {
        harness.deployment.setAppConfigProperty("auth.autologout.enabled", "true");
        harness.deployment.setAppConfigProperty("auth.autologout.idleTimeoutMinutes", 0.5);
        harness.deployment.setAppConfigProperty("auth.autologout.promptBeforeIdleSeconds", 5);
        await harness.reconcileAfterConfigChange();
      },
      login: loginAsZeus,
      assert: async () => {
        await settingsPage.clickButtonByText("Don't log me out", {
          timeout: 60000,
        });

        await settingsPage.open();
        await settingsPage.verifyProfileHeading("Zeus Giove");
        await settingsPage.signOut();
      },
      cleanup: clearSession,
    });
  });

  test.afterAll(async () => {
    await harness.cleanup();
  });
});
