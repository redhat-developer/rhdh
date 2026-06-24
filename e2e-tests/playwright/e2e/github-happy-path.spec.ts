import { test, expect, Page, BrowserContext } from "@support/coverage/test";
import { Common } from "../utils/common";
import { RESOURCES } from "../support/test-data/resources";
import { RhdhInstance, CatalogImport } from "../support/pages/catalog-import";
import { TEMPLATES } from "../support/test-data/templates";
import { SettingsPage } from "../support/pages/settings-page";
import { CatalogBrowsePage } from "../support/pages/catalog-browse-page";
import { SelfServicePage } from "../support/pages/self-service-page";
import {
  createManagedBrowserSession,
  type ManagedBrowserSession,
} from "../support/fixtures/managed-browser";

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

async function getRhdhPullRequests(
  state: "open" | "closed" | "all",
  paginated = false,
): Promise<GithubPullRequest[]> {
  const data: unknown = await RhdhInstance.getRhdhPullRequests(
    state,
    paginated,
  );
  return parseGithubPullRequests(data);
}

let page: Page;
let browserContext: BrowserContext;
let browserSession: ManagedBrowserSession;

// Blocked by https://issues.redhat.com/browse/RHDHBUGS-2099
test.describe("GitHub Happy path", { tag: "@blocked" }, () => {
  let common: Common;
  let settingsPage: SettingsPage;
  let catalogBrowsePage: CatalogBrowsePage;
  let selfServicePage: SelfServicePage;
  let catalogImport: CatalogImport;
  let rhdhInstance: RhdhInstance;

  const component =
    "https://github.com/redhat-developer/rhdh/blob/main/catalog-entities/all.yaml";

  test.beforeEach(() => {
    test.skip(
      true,
      "RHDHBUGS-2099: GitHub happy path blocked pending catalog entity updates",
    );
  });

  test.beforeAll(async ({ browser }, testInfo) => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });

    browserSession = await createManagedBrowserSession(browser, testInfo);
    page = browserSession.page;
    browserContext = browserSession.context;
    settingsPage = new SettingsPage(page);
    catalogBrowsePage = new CatalogBrowsePage(page);
    selfServicePage = new SelfServicePage(page);
    common = new Common(page);
    catalogImport = new CatalogImport(page);
    rhdhInstance = new RhdhInstance(page);
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
    await settingsPage.open();
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
    await catalogBrowsePage.openCatalogSidebar();
    await catalogBrowsePage.selectKind("Component");
    await catalogBrowsePage.importGitRepositoryFromCatalog();
    await catalogImport.registerExistingComponent(component);
  });

  test("Verify that the following components were ingested into the Catalog", async () => {
    await catalogBrowsePage.openCatalogSidebar();
    await catalogBrowsePage.selectKind("Group");
    await catalogBrowsePage.verifyComponentsInCatalog("Group", [
      "Janus-IDP Authors",
    ]);

    await catalogBrowsePage.verifyComponentsInCatalog("API", ["Petstore"]);
    await catalogBrowsePage.verifyComponentsInCatalog("Component", [
      "Red Hat Developer Hub",
    ]);

    await catalogBrowsePage.selectKind("Resource");
    await catalogBrowsePage.verifyTableRows([
      "ArgoCD",
      "RHDH GitHub catalog",
      "KeyCloak",
      "PostgreSQL cluster",
      "S3 Object bucket storage",
    ]);

    await catalogBrowsePage.openCatalogSidebar();
    await catalogBrowsePage.selectKind("User");
    await catalogBrowsePage.searchCatalog("rhdh");
    await catalogBrowsePage.verifyTableRows(["rhdh-qe rhdh-qe"]);
    await expect(
      page.getByRole("cell", { name: "rhdh-qe rhdh-qe" }),
    ).toBeVisible();
  });

  test("Verify all 12 Software Templates appear in the Create page", async () => {
    await selfServicePage.open();
    await selfServicePage.verifyTemplatesHeading();

    for (const template of TEMPLATES) {
      await selfServicePage.waitForTemplateTitle(template, 4);
      await expect(
        page.getByRole("heading", { name: template, exact: true }),
      ).toBeVisible();
    }
  });

  test("Click login on the login popup and verify that Overview tab renders", async () => {
    await catalogBrowsePage.openCatalogSidebar("Component");
    await catalogBrowsePage.openEntityLink("Red Hat Developer Hub");

    const expectedPath = "/catalog/default/component/red-hat-developer-hub";
    // Wait for the expected path in the URL
    // Wait until the DOM is loaded
    await page.waitForURL(`**${expectedPath}`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    // Optionally, verify that the current URL contains the expected path
    expect(page.url()).toContain(expectedPath);

    await common.clickOnGHloginPopup();
    await catalogBrowsePage.verifyLink("About RHDH", { exact: false });

    // Workaround for RHDHBUGS-2091: Change the size to 10 to avoid information not being displayed
    await page.getByRole("button", { name: "20" }).click();
    await page.getByRole("option", { name: "10", exact: true }).click();

    await rhdhInstance.verifyPRStatisticsRendered();
    await rhdhInstance.verifyAboutCardIsDisplayed();
  });

  test("Verify that the Pull/Merge Requests tab renders the 5 most recently updated Open Pull Requests", async () => {
    await catalogBrowsePage.clickTab("Pull/Merge Requests");
    const openPRs = await getRhdhPullRequests("open");
    await rhdhInstance.verifyPRRows(openPRs, 0, 5);
  });

  test("Click on the CLOSED filter and verify that the 5 most recently updated Closed PRs are rendered (same with ALL)", async () => {
    // Use semantic selector and wait for button to be ready (no force needed)
    const closedButton = page.getByRole("button", { name: "CLOSED" });
    await expect(closedButton).toBeVisible();
    await expect(closedButton).toBeEnabled();
    await closedButton.click();
    const closedPRs = await getRhdhPullRequests("closed");
    await common.waitForLoad();
    await rhdhInstance.verifyPRRows(closedPRs, 0, 5);
  });

  test("Click on the arrows to verify that the next/previous/first/last pages of PRs are loaded", async () => {
    console.log("Fetching all PRs from GitHub");
    const allPRs = await getRhdhPullRequests("all", true);

    console.log("Clicking on ALL button");
    // Use semantic selector and wait for button to be ready (no force needed)
    const allButton = page.getByRole("button", { name: "ALL" });
    await expect(allButton).toBeVisible();
    await expect(allButton).toBeEnabled();
    await allButton.click();
    await rhdhInstance.verifyPRRows(allPRs, 0, 5);

    console.log("Clicking on Next Page button");
    await rhdhInstance.clickNextPage();
    await rhdhInstance.verifyPRRows(allPRs, 5, 10);

    // const lastPagePRs = Math.floor((allPRs.length - 1) / 5) * 5;
    // redhat-developer/rhdh have more than 1000 PRs open/closed and by default the latest 1000 PR results are displayed.
    const lastPagePRs = 996;

    console.log("Clicking on Last Page button");
    await rhdhInstance.clickLastPage();
    await rhdhInstance.verifyPRRows(allPRs, lastPagePRs, 1000);

    console.log("Clicking on Previous Page button");
    await rhdhInstance.clickPreviousPage();
    await common.waitForLoad();
    await rhdhInstance.verifyPRRows(allPRs, lastPagePRs - 5, lastPagePRs - 1);
  });

  test("Verify that the 5, 10, 20 items per page option properly displays the correct number of PRs", async () => {
    await catalogBrowsePage.openCatalogSidebar("Component");
    await catalogBrowsePage.openEntityLink("Red Hat Developer Hub");
    await common.clickOnGHloginPopup();
    await catalogBrowsePage.clickTab("Pull/Merge Requests");
    const allPRs = await getRhdhPullRequests("open");
    await rhdhInstance.verifyPRRowsPerPage(5, allPRs);
    await rhdhInstance.verifyPRRowsPerPage(10, allPRs);
    await rhdhInstance.verifyPRRowsPerPage(20, allPRs);
  });

  test("Click on the Dependencies tab and verify that all the relations have been listed and displayed", async () => {
    await catalogBrowsePage.openDependenciesTab();
    for (const resource of RESOURCES) {
      const resourceElement = page.locator(
        `#workspace:has-text("${resource}")`,
      );
      await resourceElement.scrollIntoViewIfNeeded();
      await expect(resourceElement).toBeVisible();
    }
  });

  test("Sign out and verify that you return back to the Sign in page", async () => {
    await settingsPage.open();
    await common.signOut();
    await browserContext.clearCookies();
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  });

  test.afterAll(async () => {
    await browserSession.dispose();
  });
});
