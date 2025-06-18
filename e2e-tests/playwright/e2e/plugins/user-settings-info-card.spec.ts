import { UI_HELPER_ELEMENTS } from "../../support/pageObjects/global-obj";
import { guestTest } from "../../support/fixtures/guest-login";

guestTest.describe("Test user settings info card", () => {
  guestTest(
    "Check if customized build info is rendered",
    async ({ page, uiHelper }) => {
      await uiHelper.openSidebar("Home");
      page.getByText("Guest").click();
      await page.getByRole("menuitem", { name: "Settings" }).click();
      await uiHelper.verifyTextInSelector(
        UI_HELPER_ELEMENTS.MuiCardHeader,
        "RHDH Build info",
      );
      await uiHelper.verifyTextInSelector(
        UI_HELPER_ELEMENTS.MuiCard("RHDH Build info"),
        "TechDocs builder: local\nAuthentication provider: Github",
      );
      await page.getByTitle("Show more").click();
      await uiHelper.verifyTextInSelector(
        UI_HELPER_ELEMENTS.MuiCard("RHDH Build info"),
        "TechDocs builder: local\nAuthentication provider: Github\nRBAC: disabled",
      );
    },
  );
});
