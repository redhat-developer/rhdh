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
    await uiHelper.clickLink({ ariaLabel: "Create..." });
  });

  test.fixme(
    "Should fetch logs for ScaffolderParameterSchemaFetch event and validate log structure and values",
    async ({ baseURL }) => {
      await uiHelper.clickButton("Register Existing Component");
      await catalogImport.registerExistingComponent(template, false);
      await uiHelper.clickLink({ ariaLabel: "Create..." });
      await common.waitForLoad();
      await uiHelper.searchInputAriaLabel("Hello World 2");
      await uiHelper.pressTab();
      await uiHelper.clickButton("Choose");

      await LogUtils.validateLogEvent(
        "ScaffolderParameterSchemaFetch",
        "user:development/guest requested the parameter schema for template:default/hello-world-2",
        "GET",
        "/api/scaffolder/v2/templates/default/template/hello-world-2/parameter-schema",
        baseURL!,
        "scaffolder",
      );
    },
  );

  test.fixme(
    "Should fetch logs for ScaffolderInstalledActionsFetch event and validate log structure and values",
    async ({ baseURL }) => {
      await uiHelper.clickById("long-menu");
      await uiHelper.clickSpanByText("Installed Actions");

      await LogUtils.validateLogEvent(
        "ScaffolderInstalledActionsFetch",
        "user:development/guest requested the list of installed actions",
        "GET",
        "/api/scaffolder/v2/actions",
        baseURL!,
        "scaffolder",
      );
    },
  );

  test.fixme(
    "Should fetch logs for ScaffolderTaskListFetch event and validate log structure and values",
    async ({ baseURL }) => {
      await uiHelper.clickById("long-menu");
      await uiHelper.clickSpanByText("Task List");

      await LogUtils.validateLogEvent(
        "ScaffolderTaskListFetch",
        "user:development/guest requested for the list of scaffolder tasks",
        "GET",
        "/api/scaffolder/v2/tasks?createdBy=user%3Adevelopment%2Fguest",
        baseURL!,
        "scaffolder",
      );
    },
  );
});
