import { test, expect, Page, BrowserContext } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import { Common, setupBrowser } from "../../utils/common";
import { RESOURCES } from "../../support/testData/resources";
import {
  BackstageShowcase,
  CatalogImport,
} from "../../support/pages/catalog-import";
import { TEMPLATES } from "../../support/testData/templates";
import RHDHDeployment from "../../utils/authentication-providers/rhdh-deployment";

let page: Page;
let context: BrowserContext;

// TODO: replace skip with serial
test.describe("GitHub Happy path", async () => {
  //TODO: skipping due to RHIDP-4992
  let common: Common;
  let uiHelper: UIhelper;
  let catalogImport: CatalogImport;
  let backstageShowcase: BackstageShowcase;

  const component =
    "https://github.com/redhat-developer/rhdh/blob/main/catalog-entities/all.yaml";

  const namespace = "albarbaro-test-namespace-github-happy-path";
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
    ({ context, page } = await setupBrowser(browser, testInfo));
    uiHelper = new UIhelper(page);
    common = new Common(page);
    catalogImport = new CatalogImport(page);
    backstageShowcase = new BackstageShowcase(page);
    test.info().setTimeout(600 * 1000);

    // load default configs from yaml files
    await deployment.loadAllConfigs();

    // expect some expected variables

    expect(process.env.AUTH_PROVIDERS_GH_ORG_NAME).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_ID).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_GH_USER_PASSWORD).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_GH_USER_2FA).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_GH_ADMIN_2FA).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_GH_ORG_APP_ID).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_GH_ORG1_PRIVATE_KEY).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_GH_ORG_WEBHOOK_SECRET).toBeDefined();

    // clean old namespaces
    await deployment.deleteNamespaceIfExists();

    // create namespace and wait for it to be active
    (await deployment.createNamespace()).waitForNamespaceActive();

    // create all base configmaps
    await deployment.createAllConfigs();

    // generate static token
    await deployment.generateStaticToken();

    // set enviroment variables and create secret
    if (!process.env.ISRUNNINGLOCAL)
      deployment.addSecretData("BASE_URL", backstageUrl);
    if (!process.env.ISRUNNINGLOCAL)
      deployment.addSecretData("BASE_BACKEND_URL", backstageBackendUrl);
    deployment.addSecretData(
      "AUTH_PROVIDERS_GH_ORG_NAME",
      process.env.AUTH_PROVIDERS_GH_ORG_NAME,
    );
    deployment.addSecretData(
      "AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET",
      process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET,
    );
    deployment.addSecretData(
      "AUTH_PROVIDERS_GH_ORG_CLIENT_ID",
      process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_ID,
    );
    deployment.addSecretData(
      "AUTH_PROVIDERS_GH_ORG_APP_ID",
      process.env.AUTH_PROVIDERS_GH_ORG_APP_ID,
    );
    deployment.addSecretData(
      "AUTH_PROVIDERS_GH_ORG1_PRIVATE_KEY",
      process.env.AUTH_PROVIDERS_GH_ORG1_PRIVATE_KEY,
    );
    deployment.addSecretData(
      "AUTH_PROVIDERS_GH_ORG_WEBHOOK_SECRET",
      process.env.AUTH_PROVIDERS_GH_ORG_WEBHOOK_SECRET,
    );

    await deployment.createSecret();

    // enable keycloak login with ingestion
    await deployment.enableGithubLoginWithIngestion();
    await deployment.setGithubResolver("usernameMatchingUserEntityName", true);

    // enable required plugins and configs
    deployment.setDynamicPluginEnabled(
      "./dynamic-plugins/dist/backstage-plugin-scaffolder-backend-module-github-dynamic",
      true,
    );
    deployment.setDynamicPluginEnabled(
      "./dynamic-plugins/dist/backstage-plugin-catalog-backend-module-github-dynamic",
      true,
    );
    deployment.setDynamicPluginEnabled(
      "./dynamic-plugins/dist/backstage-community-plugin-github-issues",
      true,
    );
    deployment.setDynamicPluginEnabled(
      "./dynamic-plugins/dist/roadiehq-backstage-plugin-github-pull-requests",
      true,
    );
    deployment.setDynamicPluginEnabled(
      "./dynamic-plugins/dist/backstage-community-plugin-github-actions",
      true,
    );
    deployment.setDynamicPluginEnabled(
      "./dynamic-plugins/dist/backstage-plugin-catalog-backend-module-github-org-dynamic",
      true,
    );
    deployment.setAppConfigProperty("catalog.providers.github", {
      "my-test-org": {
        organization: "janus-qe",
        catalogPath: "/catalog-info.yaml",
        schedule: {
          frequency: {
            minutes: 1,
          },
          timeout: {
            minutes: 1,
          },
          initialDelay: {
            seconds: 15,
          },
        },
      },
    });
    deployment.setAppConfigProperty("catalog", {
      import: {
        entityFilename: "catalog-info.yaml",
        pullRequestBranchName: "backstage-integration",
      },
      locations: [
        {
          type: "url",
          target:
            "https://github.com/janus-qe/auth-providers/blob/main/location.yaml",
        },
        {
          type: "url",
          target:
            "https://github.com/redhat-developer/rhdh/blob/main/catalog-entities/all.yaml",
        },
        {
          type: "url",
          target:
            "https://github.com/redhat-developer/red-hat-developer-hub-software-templates/blob/main/templates.yaml",
        },
      ],
      rules: [
        {
          allow: [
            "API",
            "Component",
            "Group",
            "User",
            "Resource",
            "Location",
            "System",
            "Template",
          ],
        },
      ],
    });
    deployment.setAppConfigProperty("catalog.providers.githubOrg", [
      {
        id: "github",
        githubUrl: "https://github.com",
        orgs: ["janus-qe"],
        schedule: {
          initialDelay: {
            seconds: 0,
          },
          frequency: {
            minutes: 1,
          },
          timeout: {
            minutes: 1,
          },
        },
      },
    ]);

    await deployment.updateAllConfigs();

    // create backstage deployment and wait for it to be ready
    await deployment.createBackstageDeployment();
    await deployment.waitForDeploymentReady();

    // wait for rhdh first sync and portal to be reachable
    await deployment.waitForSynced();
  });

  test("Login as a Github user.", async () => {
    const login = await common.githubLogin(
      "rhdhqeauthadmin",
      process.env.AUTH_PROVIDERS_GH_USER_PASSWORD,
      process.env.AUTH_PROVIDERS_GH_ADMIN_2FA,
    );
    expect(login).toBe("Login successful");
  });

  test("Verify Profile is Github Account Name in the Settings page", async () => {
    await page.goto("/settings");
    await expect(page).toHaveURL("/settings");
    await uiHelper.verifyHeading("rhdhqeauthadmin");
    await uiHelper.verifyHeading(`User Entity: rhdhqeauthadmin`);
  });

  test("Register an existing component", async () => {
    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Component");
    await uiHelper.clickButton("Self-service");
    await uiHelper.clickButton("Register Existing Component");
    await catalogImport.registerExistingComponent(component);
  });

  test("Verify that the following components were ingested into the Catalog", async () => {
    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Group");
    await uiHelper.verifyComponentInCatalog("Group", ["Janus-IDP Authors"]);

    await uiHelper.verifyComponentInCatalog("API", ["Petstore"]);
    await uiHelper.verifyComponentInCatalog("Component", [
      "Backstage Showcase",
    ]);

    await uiHelper.selectMuiBox("Kind", "Resource");
    await uiHelper.verifyRowsInTable([
      "ArgoCD",
      "GitHub Showcase repository",
      "KeyCloak",
      "PostgreSQL cluster",
      "S3 Object bucket storage",
    ]);

    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "User");
    await uiHelper.searchInputPlaceholder("rhdh");
    await uiHelper.verifyRowsInTable(["rhdh-qe"]);
  });

  test("Verify all 12 Software Templates appear in the Create page", async () => {
    await uiHelper.clickLink({ ariaLabel: "Self-service" });
    await uiHelper.verifyHeading("Templates");

    for (const template of TEMPLATES) {
      await uiHelper.waitForTitle(template, 4);
      await uiHelper.verifyHeading(template);
    }
  });

  test("Click login on the login popup and verify that Overview tab renders", async () => {
    await uiHelper.openCatalogSidebar("Component");
    await uiHelper.clickLink("Backstage Showcase");

    const expectedPath = "/catalog/default/component/backstage-showcase";
    // Wait for the expected path in the URL
    await page.waitForURL(`**${expectedPath}`, {
      waitUntil: "domcontentloaded", // Wait until the DOM is loaded
      timeout: 10000,
    });
    // Optionally, verify that the current URL contains the expected path
    await expect(page.url()).toContain(expectedPath);

    await common.clickOnGHloginPopup();
    await uiHelper.verifyLink("Janus Website", { exact: false });
    await backstageShowcase.verifyPRStatisticsRendered();
    await backstageShowcase.verifyAboutCardIsDisplayed();
  });

  test("Verify that the Issues tab renders all the open github issues in the repository", async () => {
    await uiHelper.clickTab("Issues");
    await common.clickOnGHloginPopup();
    const openIssues = await backstageShowcase.getGithubOpenIssues();

    const issuesCountText = new RegExp(
      `All repositories \\(${openIssues.length} Issue.*\\)`,
    );
    await expect(page.getByText(issuesCountText)).toBeVisible();

    for (const issue of openIssues.slice(0, 5)) {
      await uiHelper.verifyText(issue.title.replace(/\s+/g, " "));
    }
  });

  test("Verify that the Pull/Merge Requests tab renders the 5 most recently updated Open Pull Requests", async () => {
    await uiHelper.clickTab("Pull/Merge Requests");
    const openPRs = await BackstageShowcase.getShowcasePRs("open");
    await backstageShowcase.verifyPRRows(openPRs, 0, 5);
  });

  test("Click on the CLOSED filter and verify that the 5 most recently updated Closed PRs are rendered (same with ALL)", async () => {
    await uiHelper.clickButton("CLOSED", { force: true });
    const closedPRs = await BackstageShowcase.getShowcasePRs("closed");
    await common.waitForLoad();
    await backstageShowcase.verifyPRRows(closedPRs, 0, 5);
  });

  test("Click on the arrows to verify that the next/previous/first/last pages of PRs are loaded", async () => {
    console.log("Fetching all PRs from GitHub");
    const allPRs = await BackstageShowcase.getShowcasePRs("all", true);

    console.log("Clicking on ALL button");
    await uiHelper.clickButton("ALL", { force: true });
    await backstageShowcase.verifyPRRows(allPRs, 0, 5);

    console.log("Clicking on Next Page button");
    await backstageShowcase.clickNextPage();
    await backstageShowcase.verifyPRRows(allPRs, 5, 10);

    // const lastPagePRs = Math.floor((allPRs.length - 1) / 5) * 5;
    const lastPagePRs = 996; // redhat-developer/rhdh have more than 1000 PRs open/closed and by default the latest 1000 PR results are displayed.

    console.log("Clicking on Last Page button");
    await backstageShowcase.clickLastPage();
    await backstageShowcase.verifyPRRows(allPRs, lastPagePRs, 1000);

    console.log("Clicking on Previous Page button");
    await backstageShowcase.clickPreviousPage();
    await common.waitForLoad();
    await backstageShowcase.verifyPRRows(
      allPRs,
      lastPagePRs - 5,
      lastPagePRs - 1,
    );
  });

  test("Verify that the 5, 10, 20 items per page option properly displays the correct number of PRs", async () => {
    await uiHelper.openCatalogSidebar("Component");
    await uiHelper.clickLink("Backstage Showcase");
    await common.clickOnGHloginPopup();
    await uiHelper.clickTab("Pull/Merge Requests");
    const allPRs = await BackstageShowcase.getShowcasePRs("open");
    await backstageShowcase.verifyPRRowsPerPage(5, allPRs);
    await backstageShowcase.verifyPRRowsPerPage(10, allPRs);
    await backstageShowcase.verifyPRRowsPerPage(20, allPRs);
  });

  test("Verify that the CI tab renders 5 most recent github actions and verify the table properly displays the actions when page sizes are changed and filters are applied", async () => {
    await page.locator("a").getByText("CI", { exact: true }).first().click();
    await common.checkAndClickOnGHloginPopup();

    const workflowRuns = await backstageShowcase.getWorkflowRuns();

    for (const workflowRun of workflowRuns.slice(0, 5)) {
      await uiHelper.verifyText(workflowRun.id);
    }
  });

  test("Click on the Dependencies tab and verify that all the relations have been listed and displayed", async () => {
    await uiHelper.clickTab("Dependencies");
    for (const resource of RESOURCES) {
      const resourceElement = page.locator(
        `#workspace:has-text("${resource}")`,
      );
      await resourceElement.scrollIntoViewIfNeeded();
      await expect(resourceElement).toBeVisible();
    }
  });

  test("Sign out and verify that you return back to the Sign in page", async () => {
    await uiHelper.goToSettingsPage();
    await common.signOut();
    context.clearCookies();
  });

  test.afterAll(async () => {
    await page.close();
  });
});
