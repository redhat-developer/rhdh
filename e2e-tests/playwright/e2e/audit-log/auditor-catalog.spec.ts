import { LogUtils } from "./log-utils";
import { CatalogImport } from "../../support/pages/catalog-import";
import { APIHelper } from "../../utils/api-helper";
import { guestTest } from "../../support/fixtures/guest-login";

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

const myGuestTest = guestTest.extend<{
  catalogImport: CatalogImport;
}>({
  catalogImport: async ({ page }, use) => await use(new CatalogImport(page)),
});

myGuestTest.describe.serial("Audit Log check for Catalog Plugin", () => {
  myGuestTest.beforeEach(async ({ page }) => {
    await page.goto("/create");
  });

  myGuestTest(
    "Should fetch logs for entity-mutate event and validate log structure and values",
    async ({ uiHelper, catalogImport }) => {
      // Ensure the entity exists
      await ensureEntityExists();
      await uiHelper.clickButton("Register Existing Component");
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
    },
  );

  myGuestTest(
    "Should fetch logs for location-mutate event and validate log structure and values",
    async ({ uiHelper, catalogImport }) => {
      await ensureEntityDoesNotExist();
      await uiHelper.clickButton("Register Existing Component");
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
    },
  );
});
