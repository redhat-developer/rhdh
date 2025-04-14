import { test } from "@playwright/test";
import { Common } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";
import { LogUtils } from "./log-utils";
import { CatalogImport } from "../../support/pages/catalog-import";
import { type LogRequest } from "./logs";

test.describe.skip("Audit Log check for Catalog Plugin", () => {
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
    await uiHelper.clickLink({ ariaLabel: "Self-service" });
  });

  /**
   * Helper function to validate log events for Scaffolder Plugin
   */
  async function validateScaffolderLogEvent(
    eventId: string,
    request: LogRequest,
  ) {
    await LogUtils.validateLogEvent(
      eventId,
      "user:development/guest",
      request,
      undefined,
      undefined,
      "succeeded",
      "scaffolder",
    );
  }

  test("Should fetch logs for 'template-parameter-schema' event and validate log structure and values", async ({
    page,
  }) => {
    await uiHelper.clickButton("Register Existing Component");
    await catalogImport.registerExistingComponent(template, false);
    await page.waitForTimeout(1000);
    await uiHelper.clickLink({ ariaLabel: "Self-service" });
    await common.waitForLoad();
    await uiHelper.clickBtnInCard("Hello World 2", "Choose");
    await validateScaffolderLogEvent("template-parameter-schema", {
      method: "GET",
      url: "/api/scaffolder/v2/templates/default/template/hello-world-2/parameter-schema",
    });
  });

  test("Should fetch logs for 'action-fetch' event and validate log structure and values", async () => {
    await uiHelper.clickById("long-menu");
    await uiHelper.clickSpanByText("Installed Actions");

    await validateScaffolderLogEvent("action-fetch", {
      method: "GET",
      url: "/api/scaffolder/v2/actions",
    });
  });

  test("Should fetch logs for 'task' event actionType 'list' and validate log structure and values", async () => {
    await uiHelper.clickById("long-menu");
    await uiHelper.clickSpanByText("Task List");

    await validateScaffolderLogEvent("task", {
      method: "GET",
      url: "/api/scaffolder/v2/tasks?createdBy=user%3Adevelopment%2Fguest",
    });
  });
});
