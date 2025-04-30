import { test } from "@playwright/test";
import { Common } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";
import { LogUtils } from "./log-utils";
import { CatalogImport } from "../../support/pages/catalog-import";

test.describe("Audit Log check for Catalog Plugin", () => {
  let uiHelper: UIhelper;
  let common: Common;
  let catalogImport: CatalogImport;
  const template =
    "https://github.com/RoadieHQ/sample-service/blob/main/demo_template.yaml";

  test.beforeAll(async () => {
    await LogUtils.loginToOpenShift();
  });

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    catalogImport = new CatalogImport(page);
    await common.loginAsGuest();
    await page.goto("/create");
  });

  test("Should fetch logs for 'entity-mutate or location-mutate' event and validate log structure and values", async () => {
    await uiHelper.clickButton("Register Existing Component");
    const isComponentIsAlreadyRegistered =
      await catalogImport.registerExistingComponent(template, false);
    if (isComponentIsAlreadyRegistered) {
      // Then validate the log event
      await LogUtils.validateLogEvent(
        "entity-mutate",
        "user:development/guest",
        { method: "GET", url: "/api/catalog/refresh" },
      );
    } else {
      await LogUtils.validateLogEvent(
        "location-mutate",
        "user:development/guest",
        { method: "POST", url: "/api/catalog/locations" },
      );
    }
  });
});
