import { expect, test } from "@playwright/test";
import { Common } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";

test.describe("Test Quick Start plugin", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });
  let uiHelper: UIhelper;
  let common: Common;

  test.beforeEach(async ({ page }) => {
    common = new Common(page);
    uiHelper = new UIhelper(page);
  });

  test("Access Quick start from Global Header", async ({ page }) => {
    await common.loginAsKeycloakUser();
    await page.waitForTimeout(1000);
    // eslint-disable-next-line playwright/no-conditional-in-test
    if (await page.getByRole("button", { name: "Hide" }).isHidden()) {
      await uiHelper.clickButtonByLabel("Help");
      await uiHelper.clickByDataTestId("quickstart-button");
      console.log("Quick start button clicked");
    }
    await expect(page.getByRole("button", { name: "Hide" })).toBeVisible();
  });

  test("Access Quick start as Guest or Admin", async ({ page }) => {
    // eslint-disable-next-line playwright/no-conditional-in-test
    if (test.info().project.name !== "showcase-rbac") {
      await common.loginAsGuest();
    } else {
      await common.loginAsKeycloakUser();
    }
    await page.waitForTimeout(1000);
    await uiHelper.verifyText("Let's get you started with Developer Hub");
    await uiHelper.verifyText("We'll guide you through a few quick steps");
    await uiHelper.verifyText("Not started");
    await uiHelper.clickButtonByText("Set up authentication");
    await uiHelper.verifyButtonURL(
      "Learn more",
      "https://docs.redhat.com/en/documentation/red_hat_developer_hub/latest/html/authentication_in_red_hat_developer_hub/",
      { exact: false },
    );
    await uiHelper.clickButtonByText("Configure RBAC");
    await uiHelper.verifyButtonURL("Manage access", "/rbac");
    await uiHelper.clickButtonByText("Configure Git");
    await uiHelper.verifyButtonURL(
      "Learn more",
      "https://docs.redhat.com/en/documentation/red_hat_developer_hub/latest/html/integrating_red_hat_developer_hub_with_github/",
      { exact: false },
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

  test("Access Quick start as User", async ({ page }) => {
    // eslint-disable-next-line playwright/no-conditional-in-test
    if (test.info().project.name !== "showcase-rbac") {
      test.skip();
    }
    await common.loginAsKeycloakUser(
      process.env.GH_USER2_ID,
      process.env.GH_USER2_PASS,
    );
    await page.waitForTimeout(1000);
    await uiHelper.verifyText("Let's get you started with Developer Hub");
    await uiHelper.verifyText("We'll guide you through a few quick steps");
    await uiHelper.clickButtonByText("Import application");
    await uiHelper.verifyButtonURL("Import", "/bulk-import/repositories");
    await uiHelper.clickButtonByText("Import");
    await uiHelper.verifyHeading("Bulk import");
    await uiHelper.clickButtonByText("Learn about the Catalog");
    await uiHelper.verifyButtonURL("View Catalog", "/catalog");
    await uiHelper.clickButtonByText("View Catalog");
    await uiHelper.verifyHeading(/All Components \((\d+)\)/);
    await uiHelper.clickButtonByText("Explore Self-service templates");
    await uiHelper.verifyButtonURL("Explore templates", "/create");
    await uiHelper.clickButtonByText("Explore templates");
    await uiHelper.verifyHeading("Self-service");
    await uiHelper.clickButtonByText("Find all Learning Paths");
    await uiHelper.verifyButtonURL("View Learning Paths", "/learning-paths");
    await uiHelper.clickButtonByText("View Learning Paths");
    await uiHelper.verifyHeading("Learning Paths");
    await uiHelper.verifyText("100% progress");
  });
});
