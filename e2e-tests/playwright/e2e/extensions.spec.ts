import { test as base } from "@playwright/test";
import { Common } from "../utils/common";
import { UIhelper } from "../utils/ui-helper";

const test = base.extend<{ uiHelper: UIhelper }>({
  uiHelper: async ({ page }, use) => {
    use(new UIhelper(page));
  },
});

test.describe("Admin > Extensions > Catalog", () => {
  test.beforeEach(async ({ page, uiHelper }) => {
    await new Common(page).loginAsKeycloakUser();
    await uiHelper.openSidebarButton("Administration");
    await uiHelper.openSidebar("Extensions");
    await uiHelper.verifyHeading("Extensions");
  });

  test("Tabs includes a tab for extensions", async ({ uiHelper }) => {
    await uiHelper.clickTab("Catalog");
    // TODO: check plugins grid when we initialized some test data
  });
});
