import { Page, test } from "@playwright/test";
import { Common, setupBrowser } from "../../../utils/common";
import { UIhelper } from "../../../utils/ui-helper";
import { UI_HELPER_ELEMENTS } from "../../../support/pageObjects/global-obj";
import { QuayClient } from "../../../utils/quay/quay-client";

test.describe("Test Quay Actions plugin", () => {
  let common: Common;
  let uiHelper: UIhelper;
  let page: Page;
  let quayClient: QuayClient;
  let repository: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    page = (await setupBrowser(browser, testInfo)).page;
    common = new Common(page);
    uiHelper = new UIhelper(page);
    quayClient = new QuayClient();

    await common.loginAsGuest();
    await uiHelper.openSidebar("Create...");
  });

  test("Creates Quay repository", async () => {
    repository = `rhdh-testing-quay-actions-${Date.now()}`;
    const description = "This is just a test repository to test the template";
    await uiHelper.verifyHeading("Software Templates");
    await uiHelper.clickBtnInCard("Create a Quay repository", "Choose");
    await uiHelper.waitForTitle("Create a Quay repository", 2);

    await page.getByLabel("Token").evaluate((el) => (el.style.opacity = "0"));
    await page
      .getByLabel("namespace")
      .evaluate((el) => (el.style.opacity = "0"));

    await uiHelper.fillTextInputByLabel("Repository name", repository);
    await uiHelper.fillTextInputByLabel("Token", process.env.QUAY_TOKEN);
    await uiHelper.fillTextInputByLabel(
      "namespace",
      process.env.QUAY_NAMESPACE,
    );
    await page.getByRole("button", { name: "Visiblity​" }).click();
    await page.click('li[data-value="0"]');
    await uiHelper.fillTextInputByLabel("Description", description);
    await uiHelper.clickButton("Review");
    await uiHelper.clickButton("Create");
    await page.waitForSelector(
      `${UI_HELPER_ELEMENTS.MuiTypography}:has-text("second")`,
    );
    await uiHelper.clickLink("Quay repository link");
  });

  test.afterEach(async () => {
    await quayClient.deleteRepository(process.env.QUAY_NAMESPACE, repository);
  });
});
