import { Page, test, expect } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common, setupBrowser } from "../../../utils/common";
import { getTranslations, getCurrentLanguage } from "../../localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();

let page: Page;

test.describe("Validate Sidebar Navigation Customization", () => {
  let uiHelper: UIhelper;
  let common: Common;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });

    page = (await setupBrowser(browser, testInfo)).page;
    uiHelper = new UIhelper(page);
    common = new Common(page);

    await common.loginAsGuest();
  });

  test("Verify menu order and navigate to Docs", async () => {
    // Verify presence of 'References' menu and related items
    const referencesMenu = uiHelper.getSideBarMenuItem("References");
    expect(referencesMenu).not.toBeNull();
    expect(
      referencesMenu.getByText(t["rhdh"][lang]["menuItem.apis"]),
    ).not.toBeNull();
    expect(
      referencesMenu.getByText(t["rhdh"][lang]["menuItem.learningPaths"]),
    ).not.toBeNull();

    // Verify 'Favorites' menu and 'Docs' submenu item
    const favoritesMenu = uiHelper.getSideBarMenuItem("Favorites");
    const docsMenuItem = favoritesMenu.getByText(
      t["rhdh"][lang]["menuItem.docs"],
    );
    expect(docsMenuItem).not.toBeNull();

    // Open the 'Favorites' menu and navigate to 'Docs'
    await uiHelper.openSidebarButton("Favorites");
    await uiHelper.openSidebar(t["rhdh"][lang]["menuItem.docs"]);

    // Verify if the Documentation page has loaded
    await uiHelper.verifyHeading("Documentation");
    await uiHelper.verifyText("Documentation available in", false);

    // Verify the presense/absense of the 'Test' buttons in the sidebar
    await uiHelper.verifyText("Test enabled");
    await expect(
      page.getByRole("link", { name: "Test disabled" }),
    ).toBeHidden();

    // Verify the presence/absense of nested 'Test' buttons in the sidebar
    await uiHelper.openSidebarButton("Test enabled");
    await uiHelper.verifyText("Test nested enabled");
    await expect(
      page.getByRole("link", { name: "Test nested disabled" }),
    ).toBeHidden();

    await uiHelper.verifyText("Test_i enabled");
    await expect(
      page.getByRole("link", { name: "Test_i disabled" }),
    ).toBeHidden();
  });
});
