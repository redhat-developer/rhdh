import { test } from "@playwright/test";
import { Common, setupBrowser } from "../../../utils/common";
import { UIhelper } from "../../../utils/ui-helper";
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
    await page.goto("/create");
  });

  test("Creates Sonarkube project", async () => {
    await uiHelper.clickButton("Import an existing Git repository");
    await catalogImport.registerExistingComponent(template, false);

    await uiHelper.clickLink({ ariaLabel: "Self-service" });
    await common.waitForLoad();
    await uiHelper.waitForTitle("Self-service");
    await uiHelper.searchInputPlaceholder("Create a SonarQube project");
    await uiHelper.verifyText("Create a SonarQube project");

    project = `test-sonarqube-actions-${Date.now()}`;
    projectKey = `any-key-${Date.now()}`;

    await uiHelper.clickBtnInCard("Create a SonarQube project", "Choose");

    await uiHelper.waitForTitle("Create a SonarQube project", 2);

    const baseRHDHURL: string = process.env.BASE_URL;
    const host: string = new URL(baseRHDHURL).hostname;
    const domain = host.split(".").slice(1).join(".");
    await uiHelper.fillInputWithLabel(
      "root_baseUrl",
      `https://sonar.${domain}`,
    );

    await uiHelper.selectMuiBox(
      "root_authParams__oneof_select",
      "Username and Password",
    );

    await uiHelper.fillInputWithLabel("root_authParams_username", "admin");
    await uiHelper.fillInputWithLabel("Password", "NewAdminPassword1@");

    await uiHelper.fillInputWithLabel("root_name", project);
    await uiHelper.fillInputWithLabel("root_key", projectKey);
    await uiHelper.fillInputWithLabel("root_branch", "main");
    await uiHelper.clickButton("Review");
    await uiHelper.clickButton("Create");
    await uiHelper.clickLinkWithNewTab(/SonarQube project URL/i);

    await uiHelper.isLinkVisible(project);
  });
});
