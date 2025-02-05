import { test as base } from "@playwright/test";
import { Common } from "../utils/common";
import { UiHelper } from "../utils/ui-helper";

const test = base.extend<{ uiHelper: UiHelper }>({
  uiHelper: async ({ page }, use) => {
    use(new UiHelper(page));
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
