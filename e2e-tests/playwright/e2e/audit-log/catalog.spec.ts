import { test } from "@playwright/test";
import { Common } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";
import { LogUtils } from "./log-utils";
import { CatalogImport } from "../../support/pages/catalog-import";
import { type LogRequest } from "./logs";

// Re-enable with after adapting the tests to the new audit log service
test.describe.skip("Audit Log check for Catalog Plugin", () => {
  let uiHelper: UIhelper;
  let common: Common;
  let catalogImport: CatalogImport;
  let baseApiUrl: string;
  const actorId = "user:development/guest";

  test.beforeAll(async ({ baseURL }) => {
    await LogUtils.loginToOpenShift();
    baseApiUrl = baseURL!;
  });

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    catalogImport = new CatalogImport(page);
    await common.loginAsGuest();
    await uiHelper.openSidebar("Catalog");
  });

  /**
   * Helper function to validate log events for Catalog Plugin
   */
  async function validateCatalogLogEvent(
    eventName: string,
    actorId: string,
    request?: LogRequest,
    plugin: string = "catalog",
  ) {
    await LogUtils.validateLogEvent(
      eventName,
      actorId,
      request,
      undefined,
      undefined,
      "succeeded",
      plugin,
      undefined,
      baseApiUrl,
    );
  }

  test("Should fetch logs for 'entity-facets' event and validate log structure and values", async () => {
    await validateCatalogLogEvent("entity-facets", actorId, {
      method: "GET",
      url: "/api/catalog/entity-facets",
    });
  });

  test("Should fetch logs for 'entity-fetch' event queryType 'by-name' and validate log structure and values", async () => {
    await uiHelper.openCatalogSidebar("Component");
    await uiHelper.clickLink("backstage-janus");
    await validateCatalogLogEvent("entity-fetch", actorId, {
      method: "GET",
      url: "/api/catalog/entities/by-name/component/default/backstage-janus",
    });
  });

  test("Should fetch logs for 'entity-fetch' event queryType 'by-refs' and validate log structure and values", async () => {
    await uiHelper.openCatalogSidebar("Component");
    await uiHelper.clickLink("backstage-janus");
    await validateCatalogLogEvent("entity-fetch", actorId, {
      method: "POST",
      url: "/api/catalog/entities/by-refs",
    });
  });

  test("Should fetch logs for 'entity-fetch' event queryType 'ancestry' and validate log structure and values", async () => {
    await uiHelper.openCatalogSidebar("Component");
    await uiHelper.clickLink("backstage-janus");
    await validateCatalogLogEvent("entity-fetch", actorId, {
      method: "GET",
      url: "/api/catalog/entities/by-name/component/default/backstage-janus/ancestry",
    });
  });

  test("Should fetch logs for 'entity-fetch' event queryType 'by-query' and validate log structure and values", async () => {
    await uiHelper.clickButton("Self-service");
    await validateCatalogLogEvent("entity-fetch", actorId, {
      method: "GET",
      url: "/api/catalog/entities/by-query",
    });
  });

  test("Should fetch logs for 'location-mutate' event actionType 'create' and validate log structure and values", async () => {
    const template =
      "https://github.com/RoadieHQ/sample-service/blob/main/demo_template.yaml";
    await uiHelper.clickButton("Self-service");
    await uiHelper.clickButton("Register Existing Component");
    await catalogImport.analyzeComponent(template);

    await validateCatalogLogEvent("location-mutate", actorId, {
      method: "POST",
      url: "/api/catalog/locations?dryRun=true",
    });
  });
});
