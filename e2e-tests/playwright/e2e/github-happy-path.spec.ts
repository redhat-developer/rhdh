import { test, expect, Page, BrowserContext } from "@support/coverage/test";
import { UIhelper } from "../utils/ui-helper";
import { Common, setupBrowser, teardownBrowser } from "../utils/common";
import { RESOURCES } from "../support/test-data/resources";
import {
  BackstageShowcase,
  CatalogImport,
} from "../support/pages/catalog-import";
import { TEMPLATES } from "../support/test-data/templates";

type GithubPullRequest = { title: string; number: string };

function parseGithubPullRequests(data: unknown): GithubPullRequest[] {
  if (!Array.isArray(data)) {
    throw new TypeError(`Expected GitHub PR array, got ${typeof data}`);
  }

  return data.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new TypeError(`Invalid PR entry at index ${index}`);
    }

    const title: unknown = Reflect.get(entry, "title");
    const numberValue: unknown = Reflect.get(entry, "number");

    if (typeof title !== "string") {
      throw new TypeError(`PR at index ${index} is missing a string title`);
    }

    const number =
      typeof numberValue === "string"
        ? numberValue
        : typeof numberValue === "number"
          ? String(numberValue)
          : "";

    return { title, number };
  });
}

async function getShowcasePullRequests(
  state: "open" | "closed" | "all",
  paginated = false,
): Promise<GithubPullRequest[]> {
  const data: unknown = await BackstageShowcase.getShowcasePRs(
    state,
    paginated,
  );
  return parseGithubPullRequests(data);
}

let page: Page;
let browserContext: BrowserContext;

// TODO: https://issues.redhat.com/browse/RHDHBUGS-2099
test.describe.fixme("GitHub Happy path", () => {
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

    ({ page, context: browserContext } = await setupBrowser(browser, testInfo));
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
      process.env.GH_USER2_ID!,
      process.env.GH_USER2_PASS!,
      process.env.GH_USER2_2FA_SECRET!,
    );
    expect(ghLogin).toBe("Login successful");
  });

  test("Verify Profile is Github Account Name in the Settings page", async () => {
    await uiHelper.goToSettingsPage();
    await expect(
      page.getByRole("heading", { name: process.env.GH_USER2_ID! }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: `User Entity: ${process.env.GH_USER2_ID!}`,
      }),
    ).toBeVisible();
  });

  test("Import an existing Git repository", async () => {
    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Component");
    await uiHelper.clickButton("Self-service");
    await uiHelper.clickButton("Import an existing Git repository");
    await catalogImport.registerExistingComponent(component);
    await expect(
      page.getByRole("button", { name: "Self-service" }),
    ).toBeVisible();
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
    await expect(
      page.getByRole("cell", { name: "rhdh-qe rhdh-qe" }),
    ).toBeVisible();
  });

  test("Verify all 12 Software Templates appear in the Create page", async () => {
    await uiHelper.goToSelfServicePage();
    await uiHelper.verifyHeading("Templates");

    for (const template of TEMPLATES) {
      await uiHelper.waitForTitle(template, 4);
      await expect(
        page.getByRole("heading", { name: template, exact: true }),
      ).toBeVisible();
    }
  });

  test("Click login on the login popup and verify that Overview tab renders", async () => {
    await uiHelper.openCatalogSidebar("Component");
    await uiHelper.clickLink("Red Hat Developer Hub");

    const expectedPath = "/catalog/default/component/red-hat-developer-hub";
    // Wait for the expected path in the URL
    await page.waitForURL(`**${expectedPath}`, {
      waitUntil: "domcontentloaded", // Wait until the DOM is loaded
      timeout: 20000,
    });
    // Optionally, verify that the current URL contains the expected path
    expect(page.url()).toContain(expectedPath);

    await common.clickOnGHloginPopup();
    await uiHelper.verifyLink("About RHDH", { exact: false });

    // Workaround for RHDHBUGS-2091: Change the size to 10 to avoid information not being displayed
    await page.getByRole("button", { name: "20" }).click();
    await page.getByRole("option", { name: "10", exact: true }).click();

    await backstageShowcase.verifyPRStatisticsRendered();
    await backstageShowcase.verifyAboutCardIsDisplayed();
  });

  test("Verify that the Pull/Merge Requests tab renders the 5 most recently updated Open Pull Requests", async () => {
    await uiHelper.clickTab("Pull/Merge Requests");
    const openPRs = await getShowcasePullRequests("open");
    await expect(
      backstageShowcase.verifyPRRows(openPRs, 0, 5),
    ).resolves.toBeUndefined();
  });

  test("Click on the CLOSED filter and verify that the 5 most recently updated Closed PRs are rendered (same with ALL)", async () => {
    // Use semantic selector and wait for button to be ready (no force needed)
    const closedButton = page.getByRole("button", { name: "CLOSED" });
    await expect(closedButton).toBeVisible();
    await expect(closedButton).toBeEnabled();
    await closedButton.click();
    const closedPRs = await getShowcasePullRequests("closed");
    await common.waitForLoad();
    await expect(
      backstageShowcase.verifyPRRows(closedPRs, 0, 5),
    ).resolves.toBeUndefined();
  });

  test("Click on the arrows to verify that the next/previous/first/last pages of PRs are loaded", async () => {
    console.log("Fetching all PRs from GitHub");
    const allPRs = await getShowcasePullRequests("all", true);

    console.log("Clicking on ALL button");
    // Use semantic selector and wait for button to be ready (no force needed)
    const allButton = page.getByRole("button", { name: "ALL" });
    await expect(allButton).toBeVisible();
    await expect(allButton).toBeEnabled();
    await allButton.click();
    await expect(
      backstageShowcase.verifyPRRows(allPRs, 0, 5),
    ).resolves.toBeUndefined();

    console.log("Clicking on Next Page button");
    await backstageShowcase.clickNextPage();
    await expect(
      backstageShowcase.verifyPRRows(allPRs, 5, 10),
    ).resolves.toBeUndefined();

    // const lastPagePRs = Math.floor((allPRs.length - 1) / 5) * 5;
    const lastPagePRs = 996; // redhat-developer/rhdh have more than 1000 PRs open/closed and by default the latest 1000 PR results are displayed.

    console.log("Clicking on Last Page button");
    await backstageShowcase.clickLastPage();
    await expect(
      backstageShowcase.verifyPRRows(allPRs, lastPagePRs, 1000),
    ).resolves.toBeUndefined();

    console.log("Clicking on Previous Page button");
    await backstageShowcase.clickPreviousPage();
    await common.waitForLoad();
    await expect(
      backstageShowcase.verifyPRRows(allPRs, lastPagePRs - 5, lastPagePRs - 1),
    ).resolves.toBeUndefined();
  });

  test("Verify that the 5, 10, 20 items per page option properly displays the correct number of PRs", async () => {
    await uiHelper.openCatalogSidebar("Component");
    await uiHelper.clickLink("Red Hat Developer Hub");
    await common.clickOnGHloginPopup();
    await uiHelper.clickTab("Pull/Merge Requests");
    const allPRs = await getShowcasePullRequests("open");
    await expect(
      backstageShowcase.verifyPRRowsPerPage(5, allPRs),
    ).resolves.toBeUndefined();
    await expect(
      backstageShowcase.verifyPRRowsPerPage(10, allPRs),
    ).resolves.toBeUndefined();
    await expect(
      backstageShowcase.verifyPRRowsPerPage(20, allPRs),
    ).resolves.toBeUndefined();
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
    await browserContext.clearCookies();
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  });

  test.afterAll(async (_args, testInfo) => {
    await teardownBrowser(page, testInfo);
  });
});
