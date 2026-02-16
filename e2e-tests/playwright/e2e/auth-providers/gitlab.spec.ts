import { test, expect, Page, BrowserContext } from "@playwright/test";
import RHDHDeployment from "../../utils/authentication-providers/rhdh-deployment";
import { Common, setupBrowser } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";
import { GitLabHelper } from "../../utils/authentication-providers/gitlab-helper";
let page: Page;
let context: BrowserContext;

test.describe("Configure GitLab Provider", async () => {
  let common: Common;
  let uiHelper: UIhelper;
  let gitlabHelper: GitLabHelper;
  let oauthAppId: number | null = null;

  const namespace = "albarbaro-test-namespace-gitlab";
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
    expect(process.env.AUTH_PROVIDERS_GITLAB_HOST).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_GITLAB_TOKEN).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_GITLAB_PARENT_ORG).toBeDefined();
    expect(process.env.DEFAULT_USER_PASSWORD).toBeDefined();

    // Initialize GitLab helper and create OAuth application dynamically
    gitlabHelper = new GitLabHelper({
      host: process.env.AUTH_PROVIDERS_GITLAB_HOST!,
      personalAccessToken: process.env.AUTH_PROVIDERS_GITLAB_TOKEN!,
    });

    const callbackUrl = `${backstageBackendUrl}/api/auth/gitlab/handler/frame`;
    const oauthAppName = `rhdh-test-${Date.now()}`;
    console.log(`[TEST] Creating GitLab OAuth application: ${oauthAppName}`);
    const oauthApp = await gitlabHelper.createOAuthApplication(
      oauthAppName,
      callbackUrl,
      "api read_user write_repository sudo",
      true, // trusted = true to skip UI confirmation
    );
    oauthAppId = oauthApp.id;
    console.log(
      `[TEST] GitLab OAuth application created - ID: ${oauthApp.application_id}`,
    );

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
      "AUTH_PROVIDERS_GITLAB_HOST",
      process.env.AUTH_PROVIDERS_GITLAB_HOST!,
    );
    await deployment.addSecretData(
      "AUTH_PROVIDERS_GITLAB_PARENT_ORG",
      process.env.AUTH_PROVIDERS_GITLAB_PARENT_ORG!,
    );
    await deployment.addSecretData(
      "AUTH_PROVIDERS_GITLAB_CLIENT_ID",
      oauthApp.application_id,
    );
    await deployment.addSecretData(
      "AUTH_PROVIDERS_GITLAB_CLIENT_SECRET",
      oauthApp.secret,
    );
    await deployment.addSecretData(
      "AUTH_PROVIDERS_GITLAB_TOKEN",
      process.env.AUTH_PROVIDERS_GITLAB_TOKEN!,
    );

    await deployment.createSecret();

    // enable gitlab login with ingestion
    console.log("[TEST] Enabling GitLab login with ingestion...");
    await deployment.enableGitlabLoginWithIngestion();
    await deployment.updateAllConfigs();
    console.log("[TEST] GitLab login with ingestion enabled successfully");

    // create backstage deployment and wait for it to be ready
    await deployment.createBackstageDeployment();
    await deployment.waitForDeploymentReady();

    // wait for rhdh first sync and portal to be reachable
    await deployment.waitForSynced();
  });

  test.beforeEach(async () => {
    test.info().setTimeout(60 * 1000);
    console.log(
      `Running test case ${test.info().title} - Attempt #${test.info().retry}`,
    );
  });

  test("Login with GitLab default resolver", async () => {
    const login = await common.gitlabLogin(
      "user1",
      process.env.DEFAULT_USER_PASSWORD,
    );
    expect(login).toBe("Login successful");

    await uiHelper.goToSettingsPage();
    await uiHelper.verifyHeading("user1");
    await common.signOut();
    await context.clearCookies();
  });

  test(`Ingestion of GitLab users and groups: verify the user entities and groups are created with the correct relationships`, async () => {
    await page.waitForTimeout(5000);

    expect(
      await deployment.checkUserIsIngestedInCatalog([
        "user1",
        "user2",
        "user3",
        "Administrator",
      ]),
    ).toBe(true);
    expect(
      await deployment.checkGroupIsIngestedInCatalog([
        "my-org",
        "group1",
        "all",
        "nested",
        "nested_2",
      ]),
    ).toBe(true);

    expect(await deployment.checkUserIsInGroup("user1", "all")).toBe(true);
    expect(await deployment.checkUserIsInGroup("user2", "all")).toBe(true);
    expect(await deployment.checkUserIsInGroup("user3", "all")).toBe(true);
    expect(await deployment.checkUserIsInGroup("root", "all")).toBe(true);

    expect(await deployment.checkUserIsInGroup("root", "group1")).toBe(true);

    expect(await deployment.checkUserIsInGroup("user1", "group1-nested")).toBe(
      true,
    );
    expect(await deployment.checkUserIsInGroup("user2", "group1-nested")).toBe(
      true,
    );
    expect(await deployment.checkUserIsInGroup("root", "group1-nested")).toBe(
      true,
    );

    expect(
      await deployment.checkUserIsInGroup("user3", "group1-nested-nested_2"),
    ).toBe(true);
    expect(
      await deployment.checkUserIsInGroup("root", "group1-nested-nested_2"),
    ).toBe(true);

    expect(await deployment.checkGroupIsChildOfGroup("group1", "my-org")).toBe(
      true,
    );
    expect(await deployment.checkGroupIsParentOfGroup("my-org", "group1")).toBe(
      true,
    );

    expect(await deployment.checkGroupIsChildOfGroup("all", "my-org")).toBe(
      true,
    );
    expect(await deployment.checkGroupIsParentOfGroup("my-org", "all")).toBe(
      true,
    );

    expect(
      await deployment.checkGroupIsChildOfGroup("group1-nested", "group1"),
    ).toBe(true);
    expect(
      await deployment.checkGroupIsParentOfGroup("group1", "group1-nested"),
    ).toBe(true);

    expect(
      await deployment.checkGroupIsChildOfGroup(
        "group1-nested-nested_2",
        "group1-nested",
      ),
    ).toBe(true);
    expect(
      await deployment.checkGroupIsParentOfGroup(
        "group1-nested",
        "group1-nested-nested_2",
      ),
    ).toBe(true);
  });

  test.afterAll(async () => {
    console.log("[TEST] Starting cleanup...");

    // Delete the dynamically created OAuth application
    if (oauthAppId !== null && gitlabHelper) {
      try {
        await gitlabHelper.deleteOAuthApplication(oauthAppId);
        console.log("[TEST] GitLab OAuth application deleted successfully");
      } catch (error) {
        console.error(
          "[TEST] Failed to delete GitLab OAuth application:",
          error,
        );
      }
    }

    await deployment.killRunningProcess();
    console.log("[TEST] Cleanup completed");
  });
});
