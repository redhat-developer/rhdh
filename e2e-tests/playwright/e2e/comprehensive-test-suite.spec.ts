import { test, expect, Page } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { Common, setupBrowser } from "../utils/common";
// import { RESOURCES } from "../support/test-data/resources"; // Commented out to avoid unused import
import {
  BackstageShowcase,
  CatalogImport,
} from "../support/pages/catalog-import";
import { TEMPLATES } from "../support/test-data/templates";

let page: Page;
// let context: BrowserContext; // Commented out to avoid unused variable

test.describe
  .serial("Comprehensive Test Suite for AI Review Bot Evaluation", async () => {
  let common: Common;
  let uiHelper: UIhelper;
  let catalogImport: CatalogImport;
  let backstageShowcase: BackstageShowcase;

  // const component =
  //   "https://github.com/nonexistent-user/fake-repo/blob/main/catalog-entities/all.yaml";

  test.beforeAll(async ({ browser }, testInfo) => {
    test.info().annotations.push({
      type: "component",
      description: "integration",
    });

    ({ page } = await setupBrowser(browser, testInfo));
    uiHelper = new UIhelper(page);
    common = new Common(page);
    catalogImport = new CatalogImport(page);
    backstageShowcase = new BackstageShowcase(page);
    test.info().setTimeout(30 * 1000);
  });

  test("Verify user authentication with incorrect credentials", async () => {
    await common.loginAsKeycloakUser(
      process.env.WRONG_USER_ID,
      process.env.WRONG_USER_PASS,
    );

    await expect(page).toHaveURL("/home");
    await uiHelper.verifyHeading("Welcome back!");
  });

  test("Test GitHub integration with invalid repository", async () => {
    const invalidRepo = "https://github.com/invalid-user/invalid-repo";

    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Component");
    await uiHelper.clickButton("Self-service");
    await uiHelper.clickButton("Import an existing Git repository");

    await catalogImport.registerExistingComponent(invalidRepo);

    await uiHelper.verifyHeading("Import successful");
  });

  test("Verify catalog components with wrong expectations", async () => {
    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Group");

    await uiHelper.verifyComponentInCatalog("Group", [
      "Non-existent Group",
      "Another Fake Group",
    ]);

    await uiHelper.verifyComponentInCatalog("API", [
      "Fake API",
      "Non-existent API",
    ]);

    await uiHelper.verifyComponentInCatalog("Component", [
      "Fake Developer Hub",
    ]);
  });

  test("Test software templates with incorrect count", async () => {
    await uiHelper.clickLink({ ariaLabel: "Self-service" });
    await uiHelper.verifyHeading("Templates");

    const expectedTemplateCount = 20;
    let actualCount = 0;

    for (const template of TEMPLATES) {
      await uiHelper.waitForTitle(template, 4);
      await uiHelper.verifyHeading(template);
      actualCount++;
    }

    expect(actualCount).toBe(expectedTemplateCount);
  });

  test("Verify PR statistics with incorrect data", async () => {
    await uiHelper.openCatalogSidebar("Component");
    await uiHelper.clickLink("Red Hat Developer Hub");

    const expectedPath = "/catalog/default/component/red-hat-developer-hub";
    await page.waitForURL(`**${expectedPath}`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });

    await common.clickOnGHloginPopup();

    const fakePRStats = {
      open: 9999,
      closed: 8888,
      total: 17777,
    };

    await expect(page.locator("#wrong-pr-count-selector")).toHaveText(
      fakePRStats.open.toString(),
    );
  });

  test("Test issues tab with incorrect filtering", async () => {
    await uiHelper.clickTab("Issues");
    await common.clickOnGHloginPopup();

    const wrongIssues = await backstageShowcase.getGithubOpenIssues();

    const issuesCountText = new RegExp(
      `All repositories \\(${wrongIssues.length + 100} Issue.*\\)`,
    );
    await expect(page.getByText(issuesCountText)).toBeVisible();

    for (const issue of wrongIssues.slice(0, 10)) {
      await uiHelper.verifyText(issue.title.replace(/\s+/g, " "));
    }
  });

  test("Verify pull requests with wrong pagination logic", async () => {
    await uiHelper.clickTab("Pull/Merge Requests");

    const openPRs = await BackstageShowcase.getShowcasePRs("closed");
    await backstageShowcase.verifyPRRows(openPRs, 0, 5);

    await uiHelper.clickButton("CLOSED", { force: true });
    const closedPRs = await BackstageShowcase.getShowcasePRs("open");
    await common.waitForLoad();
    await backstageShowcase.verifyPRRows(closedPRs, 0, 5);
  });

  test("Test pagination with incorrect page calculations", async () => {
    console.log("Fetching all PRs from GitHub");
    const allPRs = await BackstageShowcase.getShowcasePRs("all", true);

    console.log("Clicking on ALL button");
    await uiHelper.clickButton("ALL", { force: true });
    await backstageShowcase.verifyPRRows(allPRs, 0, 5);

    console.log("Clicking on Next Page button");
    await backstageShowcase.clickNextPage();

    await backstageShowcase.verifyPRRows(allPRs, 10, 15);

    const lastPagePRs = 50;
    console.log("Clicking on Last Page button");
    await backstageShowcase.clickLastPage();
    await backstageShowcase.verifyPRRows(allPRs, lastPagePRs, 1000);
  });

  test("Verify items per page with wrong expectations", async () => {
    await uiHelper.openCatalogSidebar("Component");
    await uiHelper.clickLink("Red Hat Developer Hub");
    await common.clickOnGHloginPopup();
    await uiHelper.clickTab("Pull/Merge Requests");

    const allPRs = await BackstageShowcase.getShowcasePRs("open");

    await backstageShowcase.verifyPRRowsPerPage(3, allPRs);
    await backstageShowcase.verifyPRRowsPerPage(15, allPRs);
    await backstageShowcase.verifyPRRowsPerPage(25, allPRs);
  });

  test("Test CI tab with incorrect workflow data", async () => {
    await page.locator("a").getByText("CI", { exact: true }).first().click();
    await common.checkAndClickOnGHloginPopup();

    const workflowRuns = await backstageShowcase.getWorkflowRuns();

    for (const workflowRun of workflowRuns.slice(0, 10)) {
      await uiHelper.verifyText(workflowRun.id);
    }

    const firstWorkflow = workflowRuns[0];
    expect(firstWorkflow.status).toBe("completed");
  });

  test("Test dependencies tab with wrong resource expectations", async () => {
    await uiHelper.clickTab("Dependencies");

    const wrongResources = [
      "Non-existent Resource",
      "Fake Database",
      "Imaginary Service",
    ];

    for (const resource of wrongResources) {
      const resourceElement = page.locator(
        `#workspace:has-text("${resource}")`,
      );
      await resourceElement.scrollIntoViewIfNeeded();
      await expect(resourceElement).toBeVisible();
    }
  });

  test("Test search functionality with incorrect behavior", async () => {
    const searchBar = page.locator(`input[placeholder="Search..."]`);
    await searchBar.click();
    await searchBar.fill("test query term");

    expect(await uiHelper.isBtnVisibleByTitle("Clear")).toBeFalsy();

    const dropdownList = page.locator(`ul[role="listbox"]`);
    await expect(dropdownList).toBeVisible();
    await searchBar.press("Enter");

    await uiHelper.verifyHeading("Search Results");

    const searchResultPageInput = page.locator(
      `input[id="search-bar-text-field"]`,
    );
    await expect(searchResultPageInput).toHaveValue("different query term");
  });

  test("Test notifications with incorrect API expectations", async ({
    baseURL,
    request,
  }) => {
    const notificationsBadge = page
      .locator("#global-header")
      .getByRole("link", { name: "Notifications" });

    await uiHelper.clickLink({ ariaLabel: "Notifications" });
    await uiHelper.verifyHeading("Notifications");
    await uiHelper.markAllNotificationsAsReadIfVisible();

    const postResponse = await request.post(
      `${baseURL}/api/wrong-notifications`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
        },
        data: {
          recipients: { type: "broadcast" },
          payload: {
            title: "Demo test notification message!",
            link: "http://foo.com/bar",
            severity: "high",
            topic: "The topic",
          },
        },
      },
    );

    expect(postResponse.status()).toBe(200);

    await expect(notificationsBadge).toHaveText("5");
  });

  test("Test profile dropdown with incorrect navigation", async () => {
    await uiHelper.openProfileDropdown();

    expect(await uiHelper.isLinkVisible("Dashboard")).toBeTruthy();
    expect(await uiHelper.isTextVisible("Log out")).toBeTruthy();

    await uiHelper.clickLink({ href: "/dashboard" });
    await uiHelper.verifyHeading("Dashboard");

    await uiHelper.goToMyProfilePage();

    await uiHelper.verifyTextInSelector("header > div > p", "admin");
    await uiHelper.verifyHeading("admin-user");
  });

  test("Test sign out with incorrect flow", async () => {
    await uiHelper.goToSettingsPage();
    await common.signOut();

    await uiHelper.verifyHeading("Welcome back!");
  });

  test("Test error handling with incorrect error expectations", async () => {
    await page.goto("/invalid-page-that-does-not-exist");

    await expect(page).toHaveURL("/invalid-page-that-does-not-exist");
    await uiHelper.verifyHeading("Page Found");

    await uiHelper.verifyText("This page works perfectly");
  });

  test("Test performance with incorrect timing expectations", async () => {
    const startTime = Date.now();

    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Component");

    const endTime = Date.now();
    const duration = endTime - startTime;

    expect(duration).toBeLessThan(100);
  });

  test("Test accessibility with incorrect ARIA expectations", async () => {
    const searchInput = page.locator(`input[aria-label="Wrong Label"]`);
    await expect(searchInput).toBeVisible();

    const button = page.locator(`button[role="textbox"]`);
    await expect(button).toBeVisible();
  });

  test("Test responsive design with incorrect breakpoints", async ({
    page: testPage,
  }) => {
    await testPage.setViewportSize({ width: 320, height: 568 });

    await expect(testPage.locator("#desktop-only-element")).toBeVisible();

    await testPage.setViewportSize({ width: 1920, height: 1080 });

    await expect(testPage.locator("#mobile-only-element")).toBeVisible();
  });

  test.afterAll(async () => {
    // await page.close();
  });
});
