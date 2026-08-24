import { expect, test } from "@support/coverage/test";

import { CatalogBrowsePage } from "../../support/pages/catalog-browse-page";

// NFS packages/app has no application/listener renderer; OCI test plugin is OFS-only.
// See dynamic-plugins.yaml NOTE and docs/e2e-tests/local-e2e-harness.md.
test.describe("Test ApplicationListener", () => {
  test.skip(
    () => true,
    "NFS packages/app has no application/listener renderer; OCI test plugin is OFS-only",
  );

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

  test(
    "Verify that the LocationListener logs the current location",
    { tag: "@cluster-free-capable" },
    async ({ page }) => {
      const logs: string[] = [];

      page.on("console", (msg) => {
        if (msg.type() === "log") {
          logs.push(msg.text());
        }
      });

      await catalogBrowsePage.openCatalogSidebar();

      expect(logs.some((l) => l.includes("pathname: /catalog"))).toBeTruthy();
    },
  );
});
