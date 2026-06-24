import { test, expect } from "@support/coverage/test";
import { Common } from "../../../utils/common";
import { getTranslations, getCurrentLanguage } from "../../localization/locale";
import { SidebarPage } from "../../../support/pages/sidebar-page";

const t = getTranslations();
const lang = getCurrentLanguage();

test.describe(
  "Validate Sidebar Navigation Customization",
  { tag: "@layer3-equivalent" },
  () => {
    let sidebarPage: SidebarPage;
    let common: Common;

    test.beforeAll(async ({ rhdhPage }) => {
      test.info().annotations.push({
        type: "component",
        description: "plugins",
      });

      sidebarPage = new SidebarPage(rhdhPage);
      common = new Common(rhdhPage);

      await common.loginAsGuest();
    });

    test("Verify menu order and navigate to Docs", async () => {
      const referencesMenu = sidebarPage.getSideBarMenuItem("References");
      expect(referencesMenu).not.toBeNull();
      expect(
        referencesMenu.getByText(t["rhdh"][lang]["menuItem.apis"]),
      ).not.toBeNull();
      expect(
        referencesMenu.getByText(t["rhdh"][lang]["menuItem.learningPaths"]),
      ).not.toBeNull();

      const favoritesMenu = sidebarPage.getSideBarMenuItem("Favorites");
      const docsMenuItem = favoritesMenu.getByText(
        t["rhdh"][lang]["menuItem.docs"],
      );
      expect(docsMenuItem).not.toBeNull();

      await sidebarPage.openSidebarButton("Favorites");
      await sidebarPage.openSidebar(t["rhdh"][lang]["menuItem.docs"]);

      await sidebarPage.verifyDocumentationHeading();
      await sidebarPage.verifyText("Documentation available in", false);
      await sidebarPage.verifyText("Test enabled");
      await sidebarPage.verifyLinkHidden("Test disabled");

      await sidebarPage.openSidebarButton("Test enabled");
      await sidebarPage.verifyText("Test nested enabled");
      await sidebarPage.verifyLinkHidden("Test nested disabled");

      await sidebarPage.verifyText("Test_i enabled");
      await sidebarPage.verifyLinkHidden("Test_i disabled");
    });
  },
);
