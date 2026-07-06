import { test, expect, BrowserContext } from "@support/coverage/test";

import { AuthProviderHarness } from "../../support/fixtures/auth-provider-harness";
import { SettingsPage } from "../../support/pages/settings-page";
import { GitLabHelper } from "../../utils/authentication-providers/gitlab-helper";
import { Common } from "../../utils/common";

/* SUPORTED RESOLVERS
GITLAB:
    [x] userIdMatchingUserEntityAnnotation -> (Default >=1.10.x)
    [x] usernameMatchingUserEntityName -> (Default <=1.9.x)
    [x] emailMatchingUserEntityProfileEmail
    [x] emailLocalPartMatchingUserEntityName
*/

const harness = await AuthProviderHarness.create("albarbaro-test-namespace-gitlab");

test.describe("Configure GitLab Provider", () => {
  test.use({ baseURL: harness.backstageUrl });

  let common: Common;
  let settingsPage: SettingsPage;
  let context: BrowserContext;
  let gitlabHelper: GitLabHelper;
  let oauthAppId: number | null = null;

  test.beforeAll(async ({ rhdhPage, rhdhContext }) => {
    test.info().annotations.push({
      type: "component",
      description: "authentication",
    });

    context = rhdhContext;
    common = new Common(rhdhPage);
    settingsPage = new SettingsPage(rhdhPage);

    harness.expectEnvVars([
      "AUTH_PROVIDERS_GITLAB_HOST",
      "AUTH_PROVIDERS_GITLAB_TOKEN",
      "AUTH_PROVIDERS_GITLAB_PARENT_ORG",
      "DEFAULT_USER_PASSWORD",
    ]);

    await harness.loadConfigsAndProvisionNamespace();

    gitlabHelper = new GitLabHelper({
      host: process.env.AUTH_PROVIDERS_GITLAB_HOST!,
      personalAccessToken: process.env.AUTH_PROVIDERS_GITLAB_TOKEN!,
    });

    const callbackUrl = `${harness.backstageBackendUrl}/api/auth/gitlab/handler/frame`;
    const oauthAppName = `rhdh-test-${Date.now()}`;
    console.log(`[TEST] Creating GitLab OAuth application: ${oauthAppName}`);
    const oauthApp = await gitlabHelper.createOAuthApplication(
      oauthAppName,
      callbackUrl,
      "api read_user write_repository sudo",
      // trusted = true to skip UI confirmation
      true,
    );
    oauthAppId = oauthApp.id;
    console.log(`[TEST] GitLab OAuth application created - ID: ${oauthApp.application_id}`);

    await harness.addBaseUrlSecretsIfRemote();
    await harness.addSecretsFromEnv({
      AUTH_PROVIDERS_GITLAB_HOST: "AUTH_PROVIDERS_GITLAB_HOST",
      AUTH_PROVIDERS_GITLAB_PARENT_ORG: "AUTH_PROVIDERS_GITLAB_PARENT_ORG",
      AUTH_PROVIDERS_GITLAB_TOKEN: "AUTH_PROVIDERS_GITLAB_TOKEN",
    });
    await harness.deployment.addSecretData(
      "AUTH_PROVIDERS_GITLAB_CLIENT_ID",
      oauthApp.application_id,
    );
    await harness.deployment.addSecretData("AUTH_PROVIDERS_GITLAB_CLIENT_SECRET", oauthApp.secret);
    await harness.createSecret();

    console.log("[TEST] Enabling GitLab login with ingestion...");
    await harness.deployment.enableGitlabLoginWithIngestion();
    await harness.deployment.updateAllConfigs();
    console.log("[TEST] GitLab login with ingestion enabled successfully");

    await harness.deployAndWait();
  });

  test.beforeEach(() => {
    console.log(`Running test case ${test.info().title} - Attempt #${test.info().retry}`);
  });

  test("Login with GitLab default resolver", async () => {
    const login = await common.gitlabLogin("user1", process.env.DEFAULT_USER_PASSWORD!);
    expect(login).toBe("Login successful");

    await settingsPage.open();
    await settingsPage.verifyProfileHeading("user1");
    await common.signOut();
    await context.clearCookies();
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
