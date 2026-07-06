import { expect, test } from "@support/coverage/test";

import { CatalogBrowsePage } from "../../support/pages/catalog-browse-page";
import { Common } from "../../utils/common";

test.describe("Test ApplicationListener", () => {
  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  let catalogBrowsePage: CatalogBrowsePage;

  test.beforeEach(async ({ page }) => {
    const common = new Common(page);
    catalogBrowsePage = new CatalogBrowsePage(page);
    await common.loginAsGuest();
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
