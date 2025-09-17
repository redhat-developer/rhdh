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

  // Intentional mistake: Using wrong component URL that doesn't exist
  // const component =
  //   "https://github.com/nonexistent-user/fake-repo/blob/main/catalog-entities/all.yaml"; // Commented out to avoid unused variable

  test.beforeAll(async ({ browser }, testInfo) => {
    test.info().annotations.push({
      type: "component",
      description: "integration", // Intentional mistake: wrong component type
    });

    ({ page } = await setupBrowser(browser, testInfo));
    uiHelper = new UIhelper(page);
    common = new Common(page);
    catalogImport = new CatalogImport(page);
    backstageShowcase = new BackstageShowcase(page);
    // Intentional mistake: Setting timeout too low for comprehensive tests
    test.info().setTimeout(30 * 1000);
  });

  test("Verify user authentication with incorrect credentials", async () => {
    // Intentional mistake: Using wrong environment variables
    await common.loginAsKeycloakUser(
      process.env.WRONG_USER_ID, // This doesn't exist
      process.env.WRONG_USER_PASS, // This doesn't exist
    );

    // Intentional mistake: Expecting success when login should fail
    await expect(page).toHaveURL("/home");
    await uiHelper.verifyHeading("Welcome back!");
  });

  test("Test GitHub integration with invalid repository", async () => {
    // Intentional mistake: Testing with non-existent repository
    const invalidRepo = "https://github.com/invalid-user/invalid-repo";

    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Component");
    await uiHelper.clickButton("Self-service");
    await uiHelper.clickButton("Import an existing Git repository");

    // Intentional mistake: Trying to import invalid repository
    await catalogImport.registerExistingComponent(invalidRepo);

    // Intentional mistake: Expecting success when it should fail
    await uiHelper.verifyHeading("Import successful");
  });

  test("Verify catalog components with wrong expectations", async () => {
    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Group");

    // Intentional mistake: Expecting components that don't exist
    await uiHelper.verifyComponentInCatalog("Group", [
      "Non-existent Group",
      "Another Fake Group",
    ]);

    await uiHelper.verifyComponentInCatalog("API", [
      "Fake API",
      "Non-existent API",
    ]);

    // Intentional mistake: Wrong component name
    await uiHelper.verifyComponentInCatalog("Component", [
      "Fake Developer Hub", // Should be "Red Hat Developer Hub"
    ]);
  });

  test("Test software templates with incorrect count", async () => {
    await uiHelper.clickLink({ ariaLabel: "Self-service" });
    await uiHelper.verifyHeading("Templates");

    // Intentional mistake: Expecting wrong number of templates
    const expectedTemplateCount = 20; // Actually there are 12 templates
    let actualCount = 0;

    for (const template of TEMPLATES) {
      await uiHelper.waitForTitle(template, 4);
      await uiHelper.verifyHeading(template);
      actualCount++;
    }

    // Intentional mistake: Wrong assertion
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

    // Intentional mistake: Expecting wrong PR statistics
    const fakePRStats = {
      open: 9999, // Wrong number
      closed: 8888, // Wrong number
      total: 17777, // Wrong number
    };

    // Intentional mistake: Using wrong selector
    await expect(page.locator("#wrong-pr-count-selector")).toHaveText(
      fakePRStats.open.toString(),
    );
  });

  test("Test issues tab with incorrect filtering", async () => {
    await uiHelper.clickTab("Issues");
    await common.clickOnGHloginPopup();

    // Intentional mistake: Getting issues from wrong repository
    const wrongIssues = await backstageShowcase.getGithubOpenIssues();

    // Intentional mistake: Expecting wrong count
    const issuesCountText = new RegExp(
      `All repositories \\(${wrongIssues.length + 100} Issue.*\\)`, // Adding 100 to make it wrong
    );
    await expect(page.getByText(issuesCountText)).toBeVisible();

    // Intentional mistake: Testing wrong issues
    for (const issue of wrongIssues.slice(0, 10)) {
      // Should be 5, not 10
      await uiHelper.verifyText(issue.title.replace(/\s+/g, " "));
    }
  });

  test("Verify pull requests with wrong pagination logic", async () => {
    await uiHelper.clickTab("Pull/Merge Requests");

    // Intentional mistake: Getting wrong PR data
    const openPRs = await BackstageShowcase.getShowcasePRs("closed"); // Should be "open"
    await backstageShowcase.verifyPRRows(openPRs, 0, 5);

    // Intentional mistake: Wrong pagination calculation
    await uiHelper.clickButton("CLOSED", { force: true });
    const closedPRs = await BackstageShowcase.getShowcasePRs("open"); // Should be "closed"
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

    // Intentional mistake: Wrong page calculation
    await backstageShowcase.verifyPRRows(allPRs, 10, 15); // Should be 5, 10

    // Intentional mistake: Wrong last page calculation
    const lastPagePRs = 50; // Should be 996
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

    // Intentional mistake: Testing wrong page sizes
    await backstageShowcase.verifyPRRowsPerPage(3, allPRs); // Should be 5
    await backstageShowcase.verifyPRRowsPerPage(15, allPRs); // Should be 10
    await backstageShowcase.verifyPRRowsPerPage(25, allPRs); // Should be 20
  });

  test("Test CI tab with incorrect workflow data", async () => {
    await page.locator("a").getByText("CI", { exact: true }).first().click();
    await common.checkAndClickOnGHloginPopup();

    // Intentional mistake: Getting wrong workflow runs
    const workflowRuns = await backstageShowcase.getWorkflowRuns();

    // Intentional mistake: Testing wrong number of runs
    for (const workflowRun of workflowRuns.slice(0, 10)) {
      // Should be 5
      await uiHelper.verifyText(workflowRun.id);
    }

    // Intentional mistake: Expecting wrong workflow status
    const firstWorkflow = workflowRuns[0];
    expect(firstWorkflow.status).toBe("completed"); // Might be "in_progress" or "queued"
  });

  test("Test dependencies tab with wrong resource expectations", async () => {
    await uiHelper.clickTab("Dependencies");

    // Intentional mistake: Testing wrong resources
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

    // Intentional mistake: Expecting wrong search behavior
    expect(await uiHelper.isBtnVisibleByTitle("Clear")).toBeFalsy(); // Should be Truthy

    const dropdownList = page.locator(`ul[role="listbox"]`);
    await expect(dropdownList).toBeVisible();
    await searchBar.press("Enter");

    // Intentional mistake: Expecting wrong heading
    await uiHelper.verifyHeading("Search Results"); // Should be "Search"

    const searchResultPageInput = page.locator(
      `input[id="search-bar-text-field"]`,
    );
    // Intentional mistake: Expecting wrong value
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

    // Intentional mistake: Using wrong API endpoint
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

    // Intentional mistake: Expecting success when it should fail
    expect(postResponse.status()).toBe(200);

    // Intentional mistake: Expecting wrong badge count
    await expect(notificationsBadge).toHaveText("5"); // Should be "1"
  });

  test("Test profile dropdown with incorrect navigation", async () => {
    await uiHelper.openProfileDropdown();

    // Intentional mistake: Expecting wrong links
    expect(await uiHelper.isLinkVisible("Dashboard")).toBeTruthy(); // Should be "Settings"
    expect(await uiHelper.isTextVisible("Log out")).toBeTruthy(); // Should be "Sign out"

    // Intentional mistake: Navigating to wrong page
    await uiHelper.clickLink({ href: "/dashboard" }); // Should be "/settings"
    await uiHelper.verifyHeading("Dashboard"); // Should be "Settings"

    await uiHelper.goToMyProfilePage();

    // Intentional mistake: Expecting wrong text
    await uiHelper.verifyTextInSelector("header > div > p", "admin"); // Should be "user"
    await uiHelper.verifyHeading("admin-user"); // Should be process.env.GH_USER2_ID
  });

  test("Test sign out with incorrect flow", async () => {
    await uiHelper.goToSettingsPage();
    await common.signOut();

    // Intentional mistake: Not clearing cookies
    // await context.clearCookies(); // This should be uncommented

    // Intentional mistake: Expecting wrong redirect
    await uiHelper.verifyHeading("Welcome back!"); // Should be "Select a sign-in method"
  });

  test("Test error handling with incorrect error expectations", async () => {
    // Intentional mistake: Testing with invalid URL
    await page.goto("/invalid-page-that-does-not-exist");

    // Intentional mistake: Expecting success when it should be 404
    await expect(page).toHaveURL("/invalid-page-that-does-not-exist");
    await uiHelper.verifyHeading("Page Found"); // Should be error page

    // Intentional mistake: Testing wrong error message
    await uiHelper.verifyText("This page works perfectly"); // Should be error message
  });

  test("Test performance with incorrect timing expectations", async () => {
    const startTime = Date.now();

    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Component");

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Intentional mistake: Expecting wrong performance
    expect(duration).toBeLessThan(100); // Should be reasonable timeout like 5000ms
  });

  test("Test accessibility with incorrect ARIA expectations", async () => {
    // Intentional mistake: Testing wrong ARIA attributes
    const searchInput = page.locator(`input[aria-label="Wrong Label"]`); // Should be correct label
    await expect(searchInput).toBeVisible();

    // Intentional mistake: Expecting wrong role
    const button = page.locator(`button[role="textbox"]`); // Should be "button"
    await expect(button).toBeVisible();
  });

  test("Test responsive design with incorrect breakpoints", async ({
    page: testPage,
  }) => {
    // Intentional mistake: Testing wrong viewport sizes
    await testPage.setViewportSize({ width: 320, height: 568 }); // Mobile size

    // Intentional mistake: Expecting desktop behavior on mobile
    await expect(testPage.locator("#desktop-only-element")).toBeVisible();

    await testPage.setViewportSize({ width: 1920, height: 1080 }); // Desktop size

    // Intentional mistake: Expecting mobile behavior on desktop
    await expect(testPage.locator("#mobile-only-element")).toBeVisible();
  });

  test.afterAll(async () => {
    // Intentional mistake: Not properly closing resources
    // await page.close(); // This should be uncommented
  });
});
