import { test, expect, Page, BrowserContext } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { Common, setupBrowser } from "../utils/common";
import { RESOURCES } from "../support/test-data/resources";
import {
  BackstageShowcase,
  CatalogImport,
} from "../support/pages/catalog-import";
import { TEMPLATES } from "../support/test-data/templates";

let page: Page;
let context: BrowserContext;

// TODO: https://issues.redhat.com/browse/RHDHBUGS-2099
test.describe.fixme("GitHub Happy path", async () => {
  let common: Common;
  let uiHelper: UIhelper;
  let catalogImport: CatalogImport;
  let backstageShowcase: BackstageShowcase;

  const component =
    "https://github.com/redhat-developer/rhdh/blob/main/catalog-entities/all.yaml";

  test.beforeAll(async ({ browser }, testInfo) => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });

    ({ page, context } = await setupBrowser(browser, testInfo));
    uiHelper = new UIhelper(page);
    common = new Common(page);
    catalogImport = new CatalogImport(page);
    backstageShowcase = new BackstageShowcase(page);
    test.info().setTimeout(600 * 1000);
  });

  test("Login as a Github user from Settings page.", async () => {
    await common.loginAsKeycloakUser(
      process.env.GH_USER2_ID,
      process.env.GH_USER2_PASS,
    );
    const ghLogin = await common.githubLoginFromSettingsPage(
      process.env.GH_USER2_ID,
      process.env.GH_USER2_PASS,
      process.env.GH_USER2_2FA_SECRET,
    );
    expect(ghLogin).toBe("Login successful");
  });

  test("Verify Profile is Github Account Name in the Settings page", async () => {
    await uiHelper.goToSettingsPage();
    await uiHelper.verifyHeading(process.env.GH_USER2_ID);
    await uiHelper.verifyHeading(`User Entity: ${process.env.GH_USER2_ID}`);
  });

  test("Import an existing Git repository", async () => {
    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Component");
    await uiHelper.clickButton("Self-service");
    await uiHelper.clickButton("Import an existing Git repository");
    await catalogImport.registerExistingComponent(component);
  });

  test("Verify that the following components were ingested into the Catalog", async () => {
    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Group");
    await uiHelper.verifyComponentInCatalog("Group", ["Janus-IDP Authors"]);

    await uiHelper.verifyComponentInCatalog("API", ["Petstore"]);
    await uiHelper.verifyComponentInCatalog("Component", [
      "Red Hat Developer Hub",
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
    await uiHelper.verifyRowsInTable(["rhdh-qe rhdh-qe"]);
  });

  test("Verify all 12 Software Templates appear in the Create page", async () => {
    await uiHelper.goToSelfServicePage();
    await uiHelper.verifyHeading("Templates");

    for (const template of TEMPLATES) {
      await uiHelper.waitForTitle(template, 4);
      await uiHelper.verifyHeading(template);
    }
  });

  test("Navigate to the Red Hat Developer Hub component page", async () => {
    await uiHelper.openCatalogSidebar("Component");
    await uiHelper.clickLink("Red Hat Developer Hub");

    const expectedPath = "/catalog/default/component/red-hat-developer-hub";
    await page.waitForURL(`**${expectedPath}`, {
      waitUntil: "domcontentloaded", // Wait until the DOM is loaded
      timeout: 20000,
    });
    // Optionally, verify that the current URL contains the expected path
    expect(page.url()).toContain(expectedPath);

    await common.clickOnGHloginPopup();
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

  // TODO: https://issues.redhat.com/browse/RHDHBUGS-2099
  test.fixme("Verify that the CI tab renders 5 most recent github actions and verify the table properly displays the actions when page sizes are changed and filters are applied", async () => {
    await page.locator("a").getByText("CI", { exact: true }).first().click();
    await common.checkAndClickOnGHloginPopup();

    const workflowRuns = await backstageShowcase.getWorkflowRuns();

    for (const workflowRun of workflowRuns.slice(0, 5)) {
      await uiHelper.verifyText(workflowRun.id);
    }
  });

  // TODO: https://issues.redhat.com/browse/RHDHBUGS-2099
  test.fixme("Click on the Dependencies tab and verify that all the relations have been listed and displayed", async () => {
    await uiHelper.clickTab("Dependencies");
    for (const resource of RESOURCES) {
      const resourceElement = page.locator(
        `#workspace:has-text("${resource}")`,
      );
      await resourceElement.scrollIntoViewIfNeeded();
      await expect(resourceElement).toBeVisible();
    }
  });

  // TODO: https://issues.redhat.com/browse/RHDHBUGS-2099
  test.fixme("Sign out and verify that you return back to the Sign in page", async () => {
    await uiHelper.goToSettingsPage();
    await common.signOut();
    await context.clearCookies();
  });
});
