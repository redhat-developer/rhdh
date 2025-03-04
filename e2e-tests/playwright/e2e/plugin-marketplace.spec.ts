import { test as base } from "@playwright/test";
import { Common } from "../utils/common";
import { UIhelper } from "../utils/ui-helper";

const test = base.extend<{ uiHelper: UIhelper }>({
  uiHelper: async ({ page }, use) => {
    use(new UIhelper(page));
  },
});

test.describe("Plugin Marketplace", () => {
  test.beforeEach(async ({ page, uiHelper }) => {
    await new Common(page).loginAsKeycloakUser();
    await uiHelper.openSidebarButton("Administration");
    await uiHelper.openSidebar("Plugins");
    await uiHelper.verifyHeading("Plugins");
  });

  test("The navBar includes the marketplace", async ({ uiHelper }) => {
    await uiHelper.clickTab("Marketplace");
    // TODO: check plugins when we initialized some test data
  });
});
