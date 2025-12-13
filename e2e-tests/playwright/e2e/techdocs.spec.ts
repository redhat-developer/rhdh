import { Page, test } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { Common } from "../utils/common";
import { expect } from "@playwright/test";
import { Catalog } from "../support/pages/catalog";

test.describe("TechDocs", () => {
  let common: Common;
  let uiHelper: UIhelper;
  let catalog: Catalog;

  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
  });

  async function docsTextHighlight(page: Page) {
    await page.evaluate(() => {
      const shadowRoot = document.querySelector(
        '[data-testid="techdocs-native-shadowroot"]',
      );
      const element =
        shadowRoot.shadowRoot.querySelector("article p").firstChild;
      const range = document.createRange();
      const selection = window.getSelection();
      range.setStart(element, 0);
      range.setEnd(element, 20);
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
  }

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    catalog = new Catalog(page);
    await common.loginAsGuest();
  });

  test("Verify that TechDocs is visible in sidebar", async () => {
    await uiHelper.openSidebarButton("Favorites");
    await uiHelper.openSidebar("Docs");
  });

  test("Verify that TechDocs Docs page for Red Hat Developer Hub works", async ({
    page,
  }) => {
    await uiHelper.openSidebarButton("Favorites");
    await uiHelper.openSidebar("Docs");
    await page.getByRole("link", { name: "Red Hat Developer Hub" }).click();
    await uiHelper.waitForTitle("Getting Started running RHDH", 1);
  });

  test("Verify that TechDocs entity tab page for Red Hat Developer Hub works", async () => {
    await catalog.goToByName("Red Hat Developer Hub");
    await uiHelper.clickTab("Docs");
    await uiHelper.waitForTitle("Getting Started running RHDH", 1);
  });

  test("Verify that TechDocs Docs page for ReportIssue addon works", async ({
    page,
  }) => {
    await uiHelper.openSidebarButton("Favorites");
    await uiHelper.openSidebar("Docs");
    await page.getByRole("link", { name: "Red Hat Developer Hub" }).click();
    await page.waitForSelector("article a");
    await docsTextHighlight(page);
    const link = await page.waitForSelector("text=Open new Github issue");
    expect(await link?.isVisible()).toBeTruthy();
  });

  test("Verify that TechDocs entity tab page for ReportIssue addon works", async ({
    page,
  }) => {
    await catalog.goToByName("Red Hat Developer Hub");
    await uiHelper.clickTab("Docs");
    await page.waitForSelector("article a");
    await docsTextHighlight(page);
    const link = await page.waitForSelector("text=Open new Github issue");
    expect(await link?.isVisible()).toBeTruthy();
  });
});
