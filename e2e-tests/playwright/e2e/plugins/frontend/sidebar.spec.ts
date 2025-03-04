import { Page, test, expect } from "@playwright/test";
import { UiHelper } from "../../../utils/ui-helper";
import { Common, setupBrowser } from "../../../utils/common";

let page: Page;

test.describe("Validate Sidebar Navigation Customization", () => {
  let uiHelper: UiHelper;
  let common: Common;

  test.beforeAll(async ({ browser }, testInfo) => {
    page = (await setupBrowser(browser, testInfo)).page;
    uiHelper = new UiHelper(page);
    common = new Common(page);

    await common.loginAsGuest();
  });

  test("Verify menu order and navigate to Docs", async () => {
    // Verify presence of 'References' menu and related items
    const referencesMenu = uiHelper.getSideBarMenuItem("References");
    expect(referencesMenu).not.toBeNull();
    expect(referencesMenu.getByText("APIs")).not.toBeNull();
    expect(referencesMenu.getByText("Learning Paths")).not.toBeNull();

    // Verify 'Favorites' menu and 'Docs' submenu item
    const favoritesMenu = uiHelper.getSideBarMenuItem("Favorites");
    const docsMenuItem = favoritesMenu.getByText("Docs");
    expect(docsMenuItem).not.toBeNull();

    // Open the 'Favorites' menu and navigate to 'Docs'
    await uiHelper.openSidebarButton("Favorites");
    await uiHelper.openSidebar("Docs");

    // Verify if the Documentation page has loaded
    await uiHelper.verifyHeading("Documentation");
    await uiHelper.verifyText("Documentation available in", false);
  });
});
