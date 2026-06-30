import { test } from "@support/coverage/test";

import { CatalogImport } from "../../support/pages/catalog-import";
import { APIHelper } from "../../utils/api-helper";
import { Common } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";
import { LogUtils } from "./log-utils";
const template = "https://github.com/janus-qe/sample-service/blob/main/demo_template.yaml";
const entityName = "hello-world-2";
const namespace = "default";

async function ensureEntityExists() {
  const uid = await APIHelper.getTemplateEntityUidByName(entityName, namespace);
  if (uid === undefined || uid === "") {
    await APIHelper.registerLocation(template);
    return false;
  }
  return true;
}

async function ensureEntityDoesNotExist() {
  const id = await APIHelper.getLocationIdByTarget(template);
  if (id !== undefined && id !== "") {
    await APIHelper.deleteEntityLocationById(id);
  }
}

test.describe.serial("Audit Log check for Catalog Plugin", () => {
  let uiHelper: UIhelper;
  let common: Common;
  let catalogImport: CatalogImport;

  test.beforeAll(() => {
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
    await uiHelper.goToSelfServicePage();
  });

  test("Should fetch logs for entity-mutate event and validate log structure and values", async () => {
    await ensureEntityExists();
    await uiHelper.clickButton("Import an existing Git repository");
    await catalogImport.registerExistingComponent(template, false);
    await LogUtils.validateLogEvent(
      "entity-mutate",
      "user:development/guest",
      { method: "POST", url: "/api/catalog/refresh" },
      undefined,
      undefined,
      "succeeded",
      "catalog",
      "medium",
      ["entity-mutate", "POST", "/api/catalog/refresh"],
    );
  });

  test("Should fetch logs for location-mutate event and validate log structure and values", async () => {
    await ensureEntityDoesNotExist();
    await uiHelper.clickButton("Import an existing Git repository");
    await catalogImport.registerExistingComponent(template, false);
    await LogUtils.validateLogEvent(
      "location-mutate",
      "user:development/guest",
      { method: "POST", url: "/api/catalog/locations" },
      undefined,
      undefined,
      "succeeded",
      "catalog",
      "medium",
      ["location-mutate", "POST", "/api/catalog/locations"],
    );
  });
});
