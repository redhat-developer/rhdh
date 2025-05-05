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

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    catalogImport = new CatalogImport(page);
    await common.loginAsGuest();
    await page.goto("/create");
  });

  test("Should fetch logs for entity-mutate event and validate log structure and values", async () => {
    await uiHelper.clickButton("Register Existing Component");
    const isComponentAlreadyRegistered =
      await catalogImport.registerExistingComponent(template, false);

    const expectedEvent = isComponentAlreadyRegistered
      ? {
          eventId: "entity-mutate",
          url: "/api/catalog/refresh",
          method: "POST",
        }
      : {
          eventId: "location-mutate",
          url: "/api/catalog/locations",
          method: "POST",
        };

    await LogUtils.validateLogEvent(
      expectedEvent.eventId,
      "user:development/guest",
      { method: expectedEvent.method, url: expectedEvent.url },
      undefined, // meta
      undefined, // error
      "succeeded", // status
      "catalog", // plugin
      "medium", // severityLevel
      [expectedEvent.eventId, expectedEvent.method, expectedEvent.url],
      process.env.NAME_SPACE || "showcase-ci-nightly",
    );
  });
});
