import { test } from "@support/coverage/test";

import { SidebarPage } from "../../../support/pages/sidebar-page";
import { getTranslations, getCurrentLanguage } from "../../localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();

test.describe("Validate Sidebar Navigation Customization", { tag: "@layer3-equivalent" }, () => {
  let sidebarPage: SidebarPage;

  test.beforeAll(({ rhdhGuestPage }) => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });

    sidebarPage = new SidebarPage(rhdhGuestPage);
  });

  // @cluster-free: verified green on the cluster-free harness (playwright.legacy-local.config.ts)
  test("Verify menu order and navigate to Docs", { tag: "@cluster-free" }, async () => {
    await sidebarPage.verifyMenuItemInSection("References", t["rhdh"][lang]["menuItem.apis"]);
    await sidebarPage.verifyMenuItemInSection(
      "References",
      t["rhdh"][lang]["menuItem.learningPaths"],
    );
    await sidebarPage.verifyMenuItemInSection("Favorites", t["rhdh"][lang]["menuItem.docs"]);

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
});
