import { test, expect, Page } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { Common, setupBrowser } from "../utils/common";
import { RESOURCES } from "../support/testData/resources";
import {
  BackstageShowcase,
  CatalogImport,
} from "../support/pages/catalog-import";
import { TEMPLATES } from "../support/testData/templates";
import { HelmActions } from "../utils/helm";
import * as constants from "../utils/authenticationProviders/constants";
import { LOGGER } from "../utils/logger";
import { waitForNextSync } from "../utils/helper";

let page: Page;

// TODO: replace skip with serial
test.describe.serial("GitHub Happy path", () => {
  //TODO: skipping due to RHIDP-4992
  let common: Common;
  let uiHelper: UIhelper;
  let catalogImport: CatalogImport;
  let backstageShowcase: BackstageShowcase;
  const syncTime = 60;

  const component =
    "https://github.com/redhat-developer/rhdh/blob/main/catalog-entities/all.yaml";

  test.beforeAll(async ({ browser }, testInfo) => {
    page = (await setupBrowser(browser, testInfo)).page;

    uiHelper = new UIhelper(page);
    common = new Common(page);
    catalogImport = new CatalogImport(page);
    backstageShowcase = new BackstageShowcase(page);

    test.setTimeout(400 * 1000);

    LOGGER.info(`Base Url is ${process.env.BASE_URL}`);
    LOGGER.info(
      "Execute testcase: Setup Github authentication provider and wait for first sync",
    );

    await HelmActions.upgradeHelmChartWithWait(
      constants.AUTH_PROVIDERS_RELEASE,
      constants.AUTH_PROVIDERS_CHART,
      constants.AUTH_PROVIDERS_NAMESPACE,
      constants.AUTH_PROVIDERS_VALUES_FILE,
      constants.CHART_VERSION,
      constants.QUAY_REPO,
      constants.TAG_NAME,
      [
        "--set upstream.backstage.appConfig.signInPage=github",
        "--set upstream.backstage.appConfig.auth.environment=production",
        "--set upstream.backstage.appConfig.catalog.providers.microsoftGraphOrg=null",
        "--set upstream.backstage.appConfig.catalog.providers.keycloakOrg=null",
        "--set upstream.backstage.appConfig.auth.providers.microsoft=null",
        "--set upstream.backstage.appConfig.auth.providers.oidc=null",
        "--set global.dynamic.plugins[1].disabled=false",
        "--set global.dynamic.plugins[3].disabled=false",
        "--set global.dynamic.plugins[4].disabled=false",
        "--set global.dynamic.plugins[5].disabled=false",
        "--set global.dynamic.plugins[6].disabled=false",
        "--set global.dynamic.plugins[7].disabled=false",
        "--set global.dynamic.plugins[8].disabled=false",
        "--set upstream.backstage.appConfig.permission.enabled=false",
        "--set upstream.postgresql.primary.persistence.enabled=false",
      ],
    );

    await waitForNextSync("github", syncTime);

    await common.loginAsGithubUser();
  });

  test("Verify Profile is Github Account Name in the Settings page", async () => {
    await uiHelper.goToSettingsPage();
    await expect(page).toHaveURL("/settings");
    await uiHelper.verifyHeading(process.env.GH_USER_ID);
    await uiHelper.verifyHeading(`User Entity: ${process.env.GH_USER_ID}`);
  });

  test("Register an existing component", async () => {
    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Component");
    await uiHelper.clickButton("Create");
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
    await uiHelper.clickLink({ ariaLabel: "Create..." });
    await uiHelper.verifyHeading("Templates");

    for (const template of TEMPLATES) {
      await uiHelper.waitForTitle(template, 4);
      await uiHelper.verifyHeading(template);
    }
  });

  test("Click login on the login popup and verify that Overview tab renders", async () => {
    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Component");
    await uiHelper.clickByDataTestId("user-picker-all");
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
    await uiHelper.openSidebar("Catalog");
    await uiHelper.clickByDataTestId("user-picker-all");
    await uiHelper.clickLink("Backstage Showcase");
    await common.clickOnGHloginPopup();
    await uiHelper.clickTab("Pull/Merge Requests");
    const allPRs = await BackstageShowcase.getShowcasePRs("open");
    await backstageShowcase.verifyPRRowsPerPage(5, allPRs);
    await backstageShowcase.verifyPRRowsPerPage(10, allPRs);
    await backstageShowcase.verifyPRRowsPerPage(20, allPRs);
  });

  test("Verify that the CI tab renders 5 most recent github actions and verify the table properly displays the actions when page sizes are changed and filters are applied", async () => {
    await page.getByText("CI", { exact: true }).click();
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
  });

  test.afterAll(async () => {
    await page.close();
  });
});
