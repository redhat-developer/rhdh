import { expect, test } from "@support/coverage/test";

import { CatalogBrowsePage } from "../../support/pages/catalog-browse-page";

test.describe("Test ApplicationListener", () => {
  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  let catalogBrowsePage: CatalogBrowsePage;

  test.beforeEach(({ guestPage }) => {
    catalogBrowsePage = new CatalogBrowsePage(guestPage);
  });

  test("Verify that the LocationListener logs the current location", async ({ page }) => {
    const logs: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "log") {
        logs.push(msg.text());
      }
    });

    await catalogBrowsePage.openCatalogSidebar();

    expect(logs.some((l) => l.includes("pathname: /catalog"))).toBeTruthy();
  });
});
