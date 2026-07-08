/**
 * Historical GitHub happy-path coverage retained outside the default E2E suite.
 *
 * Blocked by https://issues.redhat.com/browse/RHDHBUGS-2099 — this file intentionally
 * does not use the `*.spec.ts` suffix and will not be picked up by Playwright discovery.
 * Restore it as an executable spec once the underlying catalog/entity issues are fixed.
 */

import type { BrowserContext, Page } from "@playwright/test";
import { test, expect } from "@support/coverage/test";

import { getCurrentLanguage, getTranslations } from "../e2e/localization/locale";
import { waitForLoadingToSettle } from "../support/auth/app-shell";
import { AuthProviderSession } from "../support/auth/provider-auth";
import { CatalogBrowsePage } from "../support/pages/catalog-browse-page";
import { RhdhInstance, CatalogImport } from "../support/pages/catalog-import";
import { SelfServicePage } from "../support/pages/self-service-page";
import { SettingsPage } from "../support/pages/settings-page";
import { RESOURCES } from "../support/test-data/resources";
import { TEMPLATES } from "../support/test-data/templates";
import * as interaction from "../utils/ui-helper/interaction";
import * as table from "../utils/ui-helper/table";
import * as visibility from "../utils/ui-helper/visibility";

export const GITHUB_HAPPY_PATH_BLOCKER = "RHDHBUGS-2099";

const t = getTranslations();
const lang = getCurrentLanguage();

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
  const data: unknown = await RhdhInstance.getRhdhPullRequests(state, paginated);
  return parseGithubPullRequests(data);
}

async function reauthorizeGithubAppIfNeeded(page: Page): Promise<void> {
  /* oxlint-disable playwright/no-raw-locators -- GitHub OAuth authorize popup (third-party) */
  await new Promise<void>((resolve) => {
    page.once("popup", async (popup) => {
      await popup.waitForLoadState();

      const authorizeButton = popup.locator("button.js-oauth-authorize-btn");
      await Promise.race([
        popup.waitForEvent("close", { timeout: 10_000 }),
        authorizeButton.waitFor({ state: "visible", timeout: 10_000 }),
      ]).catch(() => {});

      if (!popup.isClosed() && (await authorizeButton.isVisible())) {
        await popup.locator("body").click();
        await authorizeButton.waitFor();
        await authorizeButton.click();
      }
      resolve();
    });
  });
  /* oxlint-enable playwright/no-raw-locators */
}

async function clickGithubLoginPopupIfVisible(page: Page): Promise<void> {
  const signInLabel = t["user-settings"][lang]["providerSettingsItem.buttonTitle.signIn"];
  if (await visibility.isTextVisible(page, signInLabel)) {
    await interaction.clickButton(page, signInLabel);
    await interaction.clickButton(page, t["core-components"][lang]["oauthRequestDialog.login"]);
    await reauthorizeGithubAppIfNeeded(page);
    await table.waitForLoginBtnDisappear(page);
  } else {
    console.log('"Log in" button is not visible. Skipping login popup actions.');
  }
}

test.describe("GitHub Happy path", { tag: "@blocked" }, () => {
  test.describe.configure({ mode: "serial" });

  let authSession: AuthProviderSession;
  let settingsPage: SettingsPage;
  let catalogBrowsePage: CatalogBrowsePage;
  let selfServicePage: SelfServicePage;
  let catalogImport: CatalogImport;
  let rhdhInstance: RhdhInstance;
  let browserContext: BrowserContext;
  let page: Page;

  const component = "https://github.com/redhat-developer/rhdh/blob/main/catalog-entities/all.yaml";

  test.beforeEach(() => {
    test.skip(true, "RHDHBUGS-2099: GitHub happy path blocked pending catalog entity updates");
  });

  test.beforeAll(({ rhdhPage, rhdhContext, rhdhAuthSession }) => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });

    page = rhdhPage;
    browserContext = rhdhContext;
    authSession = rhdhAuthSession;
    settingsPage = new SettingsPage(rhdhPage);
    catalogBrowsePage = new CatalogBrowsePage(rhdhPage);
    selfServicePage = new SelfServicePage(rhdhPage);
    catalogImport = new CatalogImport(rhdhPage);
    rhdhInstance = new RhdhInstance(rhdhPage);
  });

  test("Login as a Github user from Settings page.", async () => {
    await authSession.loginWithKeycloak(
      process.env.GH_USER2_ID ?? "",
      process.env.GH_USER2_PASS ?? "",
    );
    const ghLogin = await authSession.loginWithGitHubFromSettingsPage(
      process.env.GH_USER2_ID!,
      process.env.GH_USER2_PASS!,
      process.env.GH_USER2_2FA_SECRET!,
    );
    expect(ghLogin).toBe("Login successful");
  });

  test("Verify Profile is Github Account Name in the Settings page", async () => {
    await settingsPage.open();
    await settingsPage.verifyGithubUserProfile(process.env.GH_USER2_ID!);
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
    await catalogBrowsePage.verifyComponentsInCatalog("Group", ["Janus-IDP Authors"]);

    await catalogBrowsePage.verifyComponentsInCatalog("API", ["Petstore"]);
    await catalogBrowsePage.verifyComponentsInCatalog("Component", ["Red Hat Developer Hub"]);

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
    await catalogBrowsePage.verifyTableCell("rhdh-qe rhdh-qe");
  });

  test("Verify all 12 Software Templates appear in the Create page", async () => {
    await selfServicePage.open();
    await selfServicePage.verifyTemplatesHeading();

    for (const template of TEMPLATES) {
      await selfServicePage.waitForTemplateTitle(template, 4);
      await selfServicePage.verifyTemplateHeading(template);
    }
  });

  test("Click login on the login popup and verify that Overview tab renders", async () => {
    await catalogBrowsePage.openCatalogSidebar("Component");
    await catalogBrowsePage.openEntityLink("Red Hat Developer Hub");

    const expectedPath = "/catalog/default/component/red-hat-developer-hub";
    await rhdhInstance.waitForEntityPath(expectedPath);

    await clickGithubLoginPopupIfVisible(page);
    await catalogBrowsePage.verifyLink("About RHDH", { exact: false });
    await rhdhInstance.setPullRequestPageSize(10);
    await rhdhInstance.verifyPRStatisticsRendered();
    await rhdhInstance.verifyAboutCardIsDisplayed();
  });

  test("Verify that the Pull/Merge Requests tab renders the 5 most recently updated Open Pull Requests", async () => {
    await catalogBrowsePage.clickTab("Pull/Merge Requests");
    const openPRs = await getRhdhPullRequests("open");
    await rhdhInstance.verifyPRRows(openPRs, 0, 5);
  });

  test("Click on the CLOSED filter and verify that the 5 most recently updated Closed PRs are rendered (same with ALL)", async () => {
    await rhdhInstance.clickPullRequestFilter("CLOSED");
    const closedPRs = await getRhdhPullRequests("closed");
    await waitForLoadingToSettle(page);
    await rhdhInstance.verifyPRRows(closedPRs, 0, 5);
  });

  test("Click on the arrows to verify that the next/previous/first/last pages of PRs are loaded", async () => {
    console.log("Fetching all PRs from GitHub");
    const allPRs = await getRhdhPullRequests("all", true);

    console.log("Clicking on ALL button");
    await rhdhInstance.clickPullRequestFilter("ALL");
    await rhdhInstance.verifyPRRows(allPRs, 0, 5);

    console.log("Clicking on Next Page button");
    await rhdhInstance.clickNextPage();
    await rhdhInstance.verifyPRRows(allPRs, 5, 10);

    const lastPagePRs = 996;

    console.log("Clicking on Last Page button");
    await rhdhInstance.clickLastPage();
    await rhdhInstance.verifyPRRows(allPRs, lastPagePRs, 1000);

    console.log("Clicking on Previous Page button");
    await rhdhInstance.clickPreviousPage();
    await waitForLoadingToSettle(page);
    await rhdhInstance.verifyPRRows(allPRs, lastPagePRs - 5, lastPagePRs - 1);
  });

  test("Verify that the 5, 10, 20 items per page option properly displays the correct number of PRs", async () => {
    await catalogBrowsePage.openCatalogSidebar("Component");
    await catalogBrowsePage.openEntityLink("Red Hat Developer Hub");
    await clickGithubLoginPopupIfVisible(page);
    await catalogBrowsePage.clickTab("Pull/Merge Requests");
    const allPRs = await getRhdhPullRequests("open");
    await rhdhInstance.verifyPRRowsPerPage(5, allPRs);
    await rhdhInstance.verifyPRRowsPerPage(10, allPRs);
    await rhdhInstance.verifyPRRowsPerPage(20, allPRs);
  });

  test("Click on the Dependencies tab and verify that all the relations have been listed and displayed", async () => {
    await catalogBrowsePage.openDependenciesTab();
    for (const resource of RESOURCES) {
      await catalogBrowsePage.verifyDependencyResource(resource);
    }
  });

  test("Sign out and verify that you return back to the Sign in page", async () => {
    await settingsPage.open();
    await settingsPage.signOut();
    await browserContext.clearCookies();
    await settingsPage.verifySignInButtonVisible();
  });
});
