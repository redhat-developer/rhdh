import { Page, test, expect } from "@support/coverage/test";
import { Common } from "../../../utils/common";
import { getTranslations, getCurrentLanguage } from "../../localization/locale";
import { SidebarPage } from "../../../support/pages/sidebar-page";
import {
  createManagedBrowserSession,
  type ManagedBrowserSession,
} from "../../../support/fixtures/managed-browser";

const t = getTranslations();
const lang = getCurrentLanguage();

let page: Page;
let browserSession: ManagedBrowserSession;

test.describe(
  "Validate Sidebar Navigation Customization",
  { tag: "@layer3-equivalent" },
  () => {
    let sidebarPage: SidebarPage;
    let common: Common;

    test.beforeAll(async ({ browser }, testInfo) => {
      test.info().annotations.push({
        type: "component",
        description: "plugins",
      });

      browserSession = await createManagedBrowserSession(browser, testInfo);
      page = browserSession.page;
      sidebarPage = new SidebarPage(page);
      common = new Common(page);

      await common.loginAsGuest();
    });

    test("Verify menu order and navigate to Docs", async () => {
      // Verify presence of 'References' menu and related items
      const referencesMenu = sidebarPage.getSideBarMenuItem("References");
      expect(referencesMenu).not.toBeNull();
      expect(
        referencesMenu.getByText(t["rhdh"][lang]["menuItem.apis"]),
      ).not.toBeNull();
      expect(
        referencesMenu.getByText(t["rhdh"][lang]["menuItem.learningPaths"]),
      ).not.toBeNull();

      // Verify 'Favorites' menu and 'Docs' submenu item
      const favoritesMenu = sidebarPage.getSideBarMenuItem("Favorites");
      const docsMenuItem = favoritesMenu.getByText(
        t["rhdh"][lang]["menuItem.docs"],
      );
      expect(docsMenuItem).not.toBeNull();

      // Open the 'Favorites' menu and navigate to 'Docs'
      await sidebarPage.openSidebarButton("Favorites");
      await sidebarPage.openSidebar(t["rhdh"][lang]["menuItem.docs"]);

      // Verify if the Documentation page has loaded
      await sidebarPage.verifyDocumentationHeading();
      await sidebarPage.verifyText("Documentation available in", false);

      // Verify the presense/absense of the 'Test' buttons in the sidebar
      await sidebarPage.verifyText("Test enabled");
      await expect(
        page.getByRole("link", { name: "Test disabled" }),
      ).toBeHidden();

      // Verify the presence/absense of nested 'Test' buttons in the sidebar
      await sidebarPage.openSidebarButton("Test enabled");
      await sidebarPage.verifyText("Test nested enabled");
      await expect(
        page.getByRole("link", { name: "Test nested disabled" }),
      ).toBeHidden();

      await sidebarPage.verifyText("Test_i enabled");
      await expect(
        page.getByRole("link", { name: "Test_i disabled" }),
      ).toBeHidden();
    });

    test.afterAll(async () => {
      await browserSession.dispose();
    });
  },
);
