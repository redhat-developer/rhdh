import { UI_HELPER_ELEMENTS } from "../../../support/pageObjects/global-obj";
import { QuayClient } from "../../../utils/quay/quay-client";
import { guestTest } from "../../../support/fixtures/guest-login";

guestTest.describe("Test Quay Actions plugin", () => {
  let quayClient: QuayClient;
  let repository: string;

  guestTest.beforeAll(async ({ uiHelper }) => {
    quayClient = new QuayClient();

    await uiHelper.clickLink({ ariaLabel: "Self-service" });
  });

  guestTest("Creates Quay repository", async ({ uiHelper, page }) => {
    repository = `quay-actions-create-${Date.now()}`;
    const description =
      "This is just a test repository to test the 'quay:create-repository' template action";
    await uiHelper.verifyHeading("Self-service");
    await uiHelper.clickBtnInCard("Create a Quay repository", "Choose");
    await uiHelper.waitForTitle("Create a Quay repository", 2);

    await uiHelper.fillTextInputByLabel("Repository name", repository);
    await uiHelper.fillTextInputByLabel("Token", process.env.QUAY_TOKEN);
    await uiHelper.fillTextInputByLabel(
      "namespace",
      process.env.QUAY_NAMESPACE,
    );
    await page.getByRole("button", { name: "Visibility​" }).click();
    await page.click('li:has-text("public")');
    await uiHelper.fillTextInputByLabel("Description", description);
    await uiHelper.clickButton("Review");
    await uiHelper.clickButton("Create");
    await page.waitForSelector(
      `${UI_HELPER_ELEMENTS.MuiTypography}:has-text("second")`,
    );
    await uiHelper.clickLink("Quay repository link");
  });

  guestTest.afterEach(async () => {
    await quayClient.deleteRepository(process.env.QUAY_NAMESPACE, repository);
  });
});
