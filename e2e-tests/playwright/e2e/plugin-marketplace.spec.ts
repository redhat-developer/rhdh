import { test as base } from "@playwright/test";
import { Common } from "../utils/common";
import { UIhelper } from "../utils/ui-helper";

const test = base.extend<{ uiHelper: UIhelper }>({
  uiHelper: async ({ page }, use) => {
    use(new UIhelper(page));
  },
});

test.describe("Plugin Marketplace", () => {
  test.beforeEach(async ({ page }) => {
    await new Common(page).loginAsKeycloakUser();
  });
  test("The navBar includes the marketplace", async ({ uiHelper }) => {
    await uiHelper.openSidebar("Marketplace");
    await uiHelper.waitForTitle("Plugins");
  });
});
