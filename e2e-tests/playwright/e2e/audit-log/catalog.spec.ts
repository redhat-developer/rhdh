import { test } from "@playwright/test";
import { Common } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";
import { LogUtils } from "./log-utils";
import { CatalogImport } from "../../support/pages/catalog-import";

test.describe("Audit Log check for Catalog Plugin", () => {
  let uiHelper: UIhelper;
  let common: Common;
  let catalogImport: CatalogImport;
  let baseApiUrl: string;

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
    message: string,
    method: string,
    apiPath: string,
    plugin: string = "catalog",
  ) {
    await LogUtils.validateLogEvent(
      eventName,
      message,
      method,
      apiPath,
      baseApiUrl,
      plugin,
    );
  }

  test("Should fetch logs for CatalogEntityFacetFetch event and validate log structure and values", async () => {
    await validateCatalogLogEvent(
      "CatalogEntityFacetFetch",
      "Entity facet fetch attempt",
      "GET",
      "/api/catalog/entity-facets",
    );
  });

  test("Should fetch logs for CatalogEntityFetchByName event and validate log structure and values", async () => {
    await uiHelper.selectMuiBox("Kind", "Component");
    await uiHelper.clickByDataTestId("user-picker-all");
    await uiHelper.clickLink("backstage-janus");
    await validateCatalogLogEvent(
      "CatalogEntityFetchByName",
      "Fetch attempt for entity with entityRef component:default/backstage-janus",
      "GET",
      "/api/catalog/entities/by-name/component/default/backstage-janus",
    );
  });

  test("Should fetch logs for CatalogEntityBatchFetch event and validate log structure and values", async () => {
    await uiHelper.selectMuiBox("Kind", "Component");
    await uiHelper.clickByDataTestId("user-picker-all");
    await uiHelper.clickLink("backstage-janus");
    await validateCatalogLogEvent(
      "CatalogEntityBatchFetch",
      "Batch entity fetch attempt",
      "POST",
      "/api/catalog/entities/by-refs",
    );
  });

  test("Should fetch logs for CatalogEntityAncestryFetch event and validate log structure and values", async () => {
    await uiHelper.selectMuiBox("Kind", "Component");
    await uiHelper.clickByDataTestId("user-picker-all");
    await uiHelper.clickLink("backstage-janus");
    await validateCatalogLogEvent(
      "CatalogEntityAncestryFetch",
      "Fetch attempt for entity ancestor of entity component:default/backstage-janus",
      "GET",
      "/api/catalog/entities/by-name/component/default/backstage-janus/ancestry",
    );
  });

  test("Should fetch logs for QueriedCatalogEntityFetch event and validate log structure and values", async () => {
    await uiHelper.clickButton("Create");
    await validateCatalogLogEvent(
      "QueriedCatalogEntityFetch",
      "Queried entity fetch attempt",
      "GET",
      "/api/catalog/entities/by-query",
    );
  });

  test("Should fetch logs for CatalogLocationCreation event and validate log structure and values", async () => {
    const template =
      "https://github.com/RoadieHQ/sample-service/blob/main/demo_template.yaml";
    await uiHelper.clickButton("Create");
    await uiHelper.clickButton("Register Existing Component");
    await catalogImport.analyzeComponent(template);

    await validateCatalogLogEvent(
      "CatalogLocationCreation",
      template,
      "POST",
      "/api/catalog/locations?dryRun=true",
    );
  });
});
