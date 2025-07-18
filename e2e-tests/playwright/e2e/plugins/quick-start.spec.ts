import { expect, test } from "@playwright/test";
import { Common } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";

test.describe("Test Quick Start plugin", () => {
  let uiHelper: UIhelper;
  let common: Common;

  test.beforeEach(async ({ page }) => {
    common = new Common(page);
    await common.loginAsKeycloakUser();
    uiHelper = new UIhelper(page);
  });

  test("Access Quick start from Global Header", async ({ page }) => {
    await page.waitForTimeout(1000);
    if (await page.getByRole("button", { name: "Hide" }).isHidden()) {
      await uiHelper.clickButtonByLabel("Help");
      await uiHelper.clickByDataTestId("quickstart-button");
      console.log("Quick start button clicked");
    }
    await expect(page.getByRole("button", { name: "Hide" })).toBeVisible();
    await uiHelper.verifyText("Let's get you started with Developer Hub");
    await uiHelper.verifyText("We'll guide you through a few quick steps");
    await uiHelper.verifyText("Not started");
    await uiHelper.clickButtonByText("Set up authentication");
    await uiHelper.verifyButtonURL(
      "Learn more",
      "https://docs.redhat.com/en/documentation/red_hat_developer_hub/latest/html/authentication_in_red_hat_developer_hub/",
    );
    await uiHelper.clickButtonByText("Configure RBAC");
    await uiHelper.verifyButtonURL("Manage access", "/rbac");
    await uiHelper.clickButtonByText("Configure Git");
    await uiHelper.verifyButtonURL(
      "Learn more",
      "https://docs.redhat.com/en/documentation/red_hat_developer_hub/latest/html/integrating_red_hat_developer_hub_with_github/",
    );
    await uiHelper.clickButtonByText("Manage plugins");
    await uiHelper.verifyButtonURL("Explore plugins", "/extensions");
    await uiHelper.clickButtonByText("Explore plugins");
    await uiHelper.verifyText("Catalog");
    await uiHelper.verifyText(/Plugins \((\d+)\)/);
    await uiHelper.verifyText("25% progress");
    await uiHelper.clickButton("Hide");
    await expect(page.getByRole("button", { name: "Hide" })).toBeHidden();
  });
});
