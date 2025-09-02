import { test, Page } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { Common, setupBrowser } from "../utils/common";
let page: Page;
test.describe.serial("GitHub integration with Org data fetching", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "api",
    });
  });

  test.skip(() => process.env.JOB_NAME.includes("osd-gcp")); // skipping due to RHIDP-5704 on OSD Env
  let common: Common;
  let uiHelper: UIhelper;

  test.beforeAll(async ({ browser }, testInfo) => {
    page = (await setupBrowser(browser, testInfo)).page;
    uiHelper = new UIhelper(page);
    common = new Common(page);
    await common.loginAsKeycloakUser();
  });

  test.beforeEach(({}, testInfo) => {
    if (testInfo.retry > 0) {
      // progressively increase test timeout for retries
      test.setTimeout(testInfo.timeout + testInfo.timeout * 0.25);
    }
  });

  test("Verify that fetching the groups of the first org works", async () => {
    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Group");

    await uiHelper.searchInputPlaceholder("maintainers");
    await uiHelper.verifyRowsInTable(["maintainers"]);

    await uiHelper.searchInputPlaceholder("r");
    await uiHelper.verifyRowsInTable(["rhdh-qes"]);
  });

  test("Verify that fetching the groups of the second org works", async () => {
    await uiHelper.searchInputPlaceholder("c");
    await uiHelper.verifyRowsInTable(["catalog-group"]);

    await uiHelper.searchInputPlaceholder("j");
    await uiHelper.verifyRowsInTable(["janus-test"]);
  });

  test("Verify that fetching the users of the orgs works", async () => {
    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "User");

    await uiHelper.searchInputPlaceholder("r");
    await uiHelper.verifyRowsInTable(["rhdh-qe rhdh-qe"]);
  });
});
