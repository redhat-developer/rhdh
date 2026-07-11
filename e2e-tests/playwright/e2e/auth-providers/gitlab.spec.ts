import { test, expect, type BrowserContext } from "@support/coverage/test";

import { AuthProviderSession } from "../../support/auth/provider-auth";
import { createAuthProviderHarness } from "../../support/fixtures/auth-provider-playwright";
import { SettingsPage } from "../../support/pages/settings-page";
import { GitLabHelper } from "../../utils/authentication-providers/gitlab-helper";

/* SUPORTED RESOLVERS
GITLAB:
    [x] userIdMatchingUserEntityAnnotation -> (Default >=1.10.x)
    [x] usernameMatchingUserEntityName -> (Default <=1.9.x)
    [x] emailMatchingUserEntityProfileEmail
    [x] emailLocalPartMatchingUserEntityName
*/

const harness = createAuthProviderHarness("albarbaro-test-namespace-gitlab");

test.describe("Configure GitLab Provider", () => {
  let authSession: AuthProviderSession;
  let settingsPage: SettingsPage;
  let context: BrowserContext;
  let gitlabHelper: GitLabHelper;
  let oauthAppId: number | null = null;
  let oauthClientId = "";
  let oauthClientSecret = "";

  async function clearSession(): Promise<void> {
    await authSession.clearAuthState(context);
  }

  test.beforeAll(async ({ rhdhPage, rhdhContext, rhdhAuthSession }) => {
    test.info().annotations.push({
      type: "component",
      description: "authentication",
    });

    context = rhdhContext;
    authSession = rhdhAuthSession;
    settingsPage = new SettingsPage(rhdhPage);

    gitlabHelper = new GitLabHelper({
      host: process.env.AUTH_PROVIDERS_GITLAB_HOST!,
      personalAccessToken: process.env.AUTH_PROVIDERS_GITLAB_TOKEN!,
    });

    await harness.prepareProvider({
      requiredEnvVars: [
        "AUTH_PROVIDERS_GITLAB_HOST",
        "AUTH_PROVIDERS_GITLAB_TOKEN",
        "AUTH_PROVIDERS_GITLAB_PARENT_ORG",
        "DEFAULT_USER_PASSWORD",
      ],
      beforeSecrets: async () => {
        const callbackUrl = `${harness.backstageBackendUrl}/api/auth/gitlab/handler/frame`;
        const oauthAppName = `rhdh-test-${Date.now()}`;
        console.log(`[TEST] Creating GitLab OAuth application: ${oauthAppName}`);
        const oauthApp = await gitlabHelper.createOAuthApplication(
          oauthAppName,
          callbackUrl,
          "api read_user write_repository sudo",
          true,
        );
        oauthAppId = oauthApp.id;
        oauthClientId = oauthApp.application_id;
        oauthClientSecret = oauthApp.secret;
        console.log(`[TEST] GitLab OAuth application created: ${oauthAppName}`);
      },
      envSecrets: {
        AUTH_PROVIDERS_GITLAB_HOST: "AUTH_PROVIDERS_GITLAB_HOST",
        AUTH_PROVIDERS_GITLAB_PARENT_ORG: "AUTH_PROVIDERS_GITLAB_PARENT_ORG",
        AUTH_PROVIDERS_GITLAB_TOKEN: "AUTH_PROVIDERS_GITLAB_TOKEN",
      },
      extraSecrets: () => ({
        AUTH_PROVIDERS_GITLAB_CLIENT_ID: oauthClientId,
        AUTH_PROVIDERS_GITLAB_CLIENT_SECRET: oauthClientSecret,
      }),
      enableProvider: async (deployment) => {
        console.log("[TEST] Enabling GitLab login with ingestion...");
        await deployment.enableGitlabLoginWithIngestion();
        console.log("[TEST] GitLab login with ingestion enabled successfully");
      },
    });
  });

  test.beforeEach(() => {
    console.log(`Running test case ${test.info().title} - Attempt #${test.info().retry}`);
  });

  test("Login with GitLab default resolver", async () => {
    await harness.runLoginCase({
      login: () => authSession.loginWithGitLab("user1", process.env.DEFAULT_USER_PASSWORD!),
      assert: async () => {
        await settingsPage.open();
        await settingsPage.verifyProfileHeading("user1");
        await settingsPage.signOut();
      },
      cleanup: clearSession,
    });
  });

  test(`Ingestion of GitLab users and groups: verify the user entities and groups are created with the correct relationships`, async () => {
    await expect
      .poll(
        () =>
          harness.deployment.checkUserIsIngestedInCatalog([
            "user1",
            "user2",
            "user3",
            "Administrator",
          ]),
        { timeout: 120_000 },
      )
      .toBe(true);
    expect(
      await harness.deployment.checkGroupIsIngestedInCatalog([
        "my-org",
        "group1",
        "all",
        "nested",
        "nested_2",
      ]),
    ).toBe(true);

    expect(await harness.deployment.checkUserIsInGroup("user1", "all")).toBe(true);
    expect(await harness.deployment.checkUserIsInGroup("user2", "all")).toBe(true);
    expect(await harness.deployment.checkUserIsInGroup("user3", "all")).toBe(true);
    expect(await harness.deployment.checkUserIsInGroup("root", "all")).toBe(true);

    expect(await harness.deployment.checkUserIsInGroup("root", "group1")).toBe(true);

    expect(await harness.deployment.checkUserIsInGroup("user1", "group1-nested")).toBe(true);
    expect(await harness.deployment.checkUserIsInGroup("user2", "group1-nested")).toBe(true);
    expect(await harness.deployment.checkUserIsInGroup("root", "group1-nested")).toBe(true);

    expect(await harness.deployment.checkUserIsInGroup("user3", "group1-nested-nested_2")).toBe(
      true,
    );
    expect(await harness.deployment.checkUserIsInGroup("root", "group1-nested-nested_2")).toBe(
      true,
    );

    expect(await harness.deployment.checkGroupIsChildOfGroup("group1", "my-org")).toBe(true);
    expect(await harness.deployment.checkGroupIsParentOfGroup("my-org", "group1")).toBe(true);

    expect(await harness.deployment.checkGroupIsChildOfGroup("all", "my-org")).toBe(true);
    expect(await harness.deployment.checkGroupIsParentOfGroup("my-org", "all")).toBe(true);

    expect(await harness.deployment.checkGroupIsChildOfGroup("group1-nested", "group1")).toBe(true);
    expect(await harness.deployment.checkGroupIsParentOfGroup("group1", "group1-nested")).toBe(
      true,
    );

    expect(
      await harness.deployment.checkGroupIsChildOfGroup("group1-nested-nested_2", "group1-nested"),
    ).toBe(true);
    expect(
      await harness.deployment.checkGroupIsParentOfGroup("group1-nested", "group1-nested-nested_2"),
    ).toBe(true);
  });

  test.afterAll(async () => {
    if (oauthAppId !== null) {
      try {
        await gitlabHelper.deleteOAuthApplication(oauthAppId);
        console.log("[TEST] GitLab OAuth application deleted successfully");
      } catch (error) {
        console.error("[TEST] Failed to delete GitLab OAuth application:", error);
      }
    }

    await harness.cleanup();
  });
});
