import { test } from "@playwright/test";
import { Common } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";
import { LogUtils } from "./log-utils";
import { CatalogImport } from "../../support/pages/catalog-import";
import { APIHelper } from "../../utils/api-helper";
const template =
  "https://github.com/RoadieHQ/sample-service/blob/main/demo_template.yaml";
const entityName = "hello-world-2";
const namespace = "default";

// Ensures the entity exists in the catalog (registers if needed)
async function ensureEntityExists() {
  const uid = await APIHelper.getTemplateEntityUidByName(entityName, namespace);
  if (!uid) {
    await APIHelper.registerLocation(template);
  }
  return !!uid;
}

// Ensures the entity does not exist in the catalog (deletes if needed)
async function ensureEntityDoesNotExist() {
  const id = await APIHelper.getLocationIdByTarget(template);
  if (id) {
    await APIHelper.deleteEntityLocationById(id);
  }
}

test.describe.serial("Audit Log check for Catalog Plugin", () => {
  let uiHelper: UIhelper;
  let common: Common;
  let catalogImport: CatalogImport;

  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "audit-log",
    });
  });

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    catalogImport = new CatalogImport(page);
    await common.loginAsGuest();
    await uiHelper.goToPageUrl("/create", "Self-service");
  });

  test("Should fetch logs for entity-mutate event and validate log structure and values", async () => {
    // Ensure the entity exists
    await ensureEntityExists();
    await uiHelper.clickButton("Import an existing Git repository");
    // Register as existing (should trigger entity-mutate)
    await catalogImport.registerExistingComponent(template, false);
    await LogUtils.validateLogEvent(
      "entity-mutate",
      "user:development/guest",
      { method: "POST", url: "/api/catalog/refresh" },
      undefined, // meta
      undefined, // error
      "succeeded", // status
      "catalog", // plugin
      "medium", // severityLevel
      ["entity-mutate", "POST", "/api/catalog/refresh"],
    );
  });

  test("Should fetch logs for location-mutate event and validate log structure and values", async () => {
    await ensureEntityDoesNotExist();
    await uiHelper.clickButton("Import an existing Git repository");
    // Register as new (should trigger location-mutate)
    await catalogImport.registerExistingComponent(template, false);
    await LogUtils.validateLogEvent(
      "location-mutate",
      "user:development/guest",
      { method: "POST", url: "/api/catalog/locations" },
      undefined, // meta
      undefined, // error
      "succeeded", // status
      "catalog", // plugin
      "medium", // severityLevel
      ["location-mutate", "POST", "/api/catalog/locations"],
    );
  });
});
