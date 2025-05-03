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

  // Login to OpenShift before all tests
  test.beforeAll(async () => {
    await LogUtils.loginToOpenShift();
  });

  // Common setup before each test
  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    catalogImport = new CatalogImport(page);
    await common.loginAsGuest();
    await page.goto("/create");
  });

  test("Should fetch logs for ScaffolderParameterSchemaFetch event and validate log structure and values", async ({
    baseURL,
    page,
  }) => {
    await uiHelper.clickButton("Register Existing Component");
    const isComponentIsAlreadyRegistered =
      await catalogImport.registerExistingComponent(template, false);
    await page.waitForTimeout(1000);

    if (isComponentIsAlreadyRegistered) {
      // Then validate the log event
      await LogUtils.validateLogEvent(
        "entity-mutate", // eventId to search for in logs
        "catalog.entity-mutate", // expected message
        "POST", // expected HTTP method
        "/api/catalog/refresh", // expected URL
        baseURL!, // base URL of the application
        "catalog", // expected plugin name
      );
    } else {
      await LogUtils.validateLogEvent(
        "location-mutate",
        "catalog.location-mutate",
        "POST",
        "/api/catalog/locations",
        baseURL!,
        "catalog",
      );
    }
  });
});
