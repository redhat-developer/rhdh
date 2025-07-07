import { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { Catalog } from "../support/pages/catalog";
import { guestTest } from "../support/fixtures/guest-login";

guestTest.describe("TechDocs", () => {
  let catalog: Catalog;

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

  guestTest.beforeEach(async ({ page }) => {
    catalog = new Catalog(page);
  });

  guestTest(
    "Verify that TechDocs is visible in sidebar",
    async ({ uiHelper }) => {
      await uiHelper.openSidebarButton("Favorites");
      await uiHelper.openSidebar("Docs");
    },
  );

  guestTest("Verify that TechDocs Docs page for Red Hat Developer Hub works", async ({
    page,uiHelper
  }) => {
    await uiHelper.openSidebarButton("Favorites");
    await uiHelper.openSidebar("Docs");
    await page.getByRole("link", { name: "Red Hat Developer Hub" }).click();
    await uiHelper.waitForTitle("Getting Started running RHDH", 1);
  });

  guestTest("Verify that TechDocs entity tab page for Red Hat Developer Hub works", async ({uiHelper}) => {
    await catalog.goToByName("Red Hat Developer Hub");
    await uiHelper.clickTab("Docs");
    await uiHelper.waitForTitle("Getting Started running RHDH", 1);
  });

  guestTest("Verify that TechDocs Docs page for ReportIssue addon works", async ({
    page, uiHelper
  }) => {
    await uiHelper.openSidebarButton("Favorites");
    await uiHelper.openSidebar("Docs");
    await page.getByRole("link", { name: "Red Hat Developer Hub" }).click();
    await page.waitForSelector("article a");
    await docsTextHighlight(page);
    const link = await page.waitForSelector("text=Open new Github issue");
    expect(await link?.isVisible()).toBeTruthy();
  });

  guestTest("Verify that TechDocs entity tab page for ReportIssue addon works", async ({
    page, uiHelper
  }) => {
    await catalog.goToByName("Red Hat Developer Hub");
    await uiHelper.clickTab("Docs");
    await page.waitForSelector("article a");
    await docsTextHighlight(page);
    const link = await page.waitForSelector("text=Open new Github issue");
    expect(await link?.isVisible()).toBeTruthy();
  });
});
