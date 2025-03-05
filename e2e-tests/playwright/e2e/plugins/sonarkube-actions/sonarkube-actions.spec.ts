import { test } from "@playwright/test";
import { Common, setupBrowser } from "../../../utils/common";
import { UIhelper } from "../../../utils/ui-helper";
import { UI_HELPER_ELEMENTS } from "../../../support/pageObjects/global-obj";
import { CatalogImport } from "../../../support/pages/catalog-import";

test.describe("Test SonarKube Actions plugin", () => {
  let common: Common;
  let uiHelper: UIhelper;
  let catalogImport: CatalogImport;
  let project: string;
  let projectKey: string;

  const template =
    "https://github.com/backstage/community-plugins/blob/main/workspaces/scaffolder-backend-module-sonarqube/plugins/scaffolder-backend-module-sonarqube/examples/templates/01-sonar-template.yaml";

  test.beforeEach(async ({ browser, page }, testInfo) => {
    page = (await setupBrowser(browser, testInfo)).page;
    common = new Common(page);
    uiHelper = new UIhelper(page);
    catalogImport = new CatalogImport(page);

    await common.loginAsGuest();
    await uiHelper.clickLink({ ariaLabel: "Create..." });
  });

  test("Creates kubernetes namespace", async ({ page }) => {
    await uiHelper.clickButton("Register Existing Component");
    await catalogImport.registerExistingComponent(template, false);
    await page.waitForTimeout(1000);
    await uiHelper.clickLink({ ariaLabel: "Create..." });
    await common.waitForLoad();

    await uiHelper.verifyHeading("Software Templates");
    await uiHelper.searchInputPlaceholder("Create a SonarQube project");
    await uiHelper.verifyText("Create a SonarQube project");

    project = `test-sonarqube-actions-${Date.now()}`;
    projectKey = `any-key-${Date.now()}`;

    await uiHelper.clickBtnInCard("Create a SonarQube project", "Choose");

    await uiHelper.waitForTitle("Create a SonarQube project", 2);
    await uiHelper.fillTextInputByLabel(
      "Base URL *",
      "https://sonarqube.apps.rosa.enptw-i8tb9-tkf.l9yc.p3.openshiftapps.com",
    );
    await uiHelper.fillTextInputByLabel(
      "Token *",
      "sqa_ae44946cb513b0e7d8500d08d654257c2bb6fdd0",
    );
    await uiHelper.fillTextInputByLabel("Name *", project);
    await uiHelper.fillTextInputByLabel("Key *", projectKey);
    await uiHelper.fillTextInputByLabel("Branch", "main");
    await uiHelper.clickButton("Review");
    await uiHelper.clickButton("Create");

    await page.waitForSelector(
      `${UI_HELPER_ELEMENTS.MuiTypography}:has-text("second")`,
    );

    // // Figure out how to use another browser tab with SonarQube service
    // const context: BrowserContext = await browser.newContext();

    // Open a new tab handler: force link to open in the same browser tab
    // const [newPage] = await Promise.all([
    //   context.waitForEvent("page"),
    //   uiHelper.clickButton("SonarQube project URL")
    // ]);

    // // Wait for the new page with SonarQube service to load
    // await newPage.waitForLoadState();
    // await page.waitForTimeout(15000);
  });
});
