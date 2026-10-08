import { expect } from "@playwright/test";
import { test } from "@support/coverage/test";

import { getRhdhSidebarNavigation } from "../support/navigation/rhdh-sidebar-adapter";
import { SettingsPage } from "../support/pages/settings-page";
import { SidebarPage } from "../support/pages/sidebar-page";
import { runAccessibilityTests } from "../utils/accessibility";

test.describe("Learning Paths", { tag: "@layer3-equivalent" }, () => {
  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  let sidebarPage: SidebarPage;

  test.beforeEach(({ guestPage }) => {
    sidebarPage = new SidebarPage(guestPage);
  });

  test(
    "Verify app-defaults Learning Paths renders bundled cards when the proxy fails",
    { tag: "@cluster-free-capable" },
    async ({ guestPage }, testInfo) => {
      let proxyRequests = 0;
      await guestPage.route("**/api/proxy/developer-hub/learning-paths", (route) => {
        proxyRequests += 1;
        return route.fulfill({ status: 503, body: "Proxy unavailable" });
      });

      await sidebarPage.openLearningPaths();
      await expect(guestPage).toHaveURL(/\/learning-paths(?:\?|$)/u);
      await sidebarPage.verifyLearningPathsHeading();
      await expect(guestPage.getByText("Building Operators on OpenShift")).toBeVisible();
      await sidebarPage.verifyLearningPathLinksOpenInNewTab();
      expect(proxyRequests).toBeGreaterThan(0);

      await runAccessibilityTests(guestPage, testInfo);
    },
  );

  test(
    "Verify app-defaults Learning Paths renders customized proxy data",
    { tag: "@cluster-free-capable" },
    async ({ guestPage }) => {
      await guestPage.route("**/api/proxy/developer-hub/learning-paths", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              label: "Custom learning path",
              description: "Configured through the proxy",
              url: "https://example.com/learning-path",
              paths: 1,
              minutes: 30,
            },
          ]),
        }),
      );

      await sidebarPage.openLearningPaths();
      await expect(guestPage.getByText("Custom learning path")).toBeVisible();
      await expect(guestPage.getByRole("link", { name: /Custom learning path/u })).toHaveAttribute(
        "href",
        "https://example.com/learning-path",
      );
    },
  );

  test(
    "Verify app-defaults translations load when switching to French",
    { tag: "@cluster-free-capable" },
    async ({ guestPage }) => {
      const settingsPage = new SettingsPage(guestPage);
      await settingsPage.open();
      await settingsPage.hideQuickstartIfVisible();
      await settingsPage.openLanguageSelect();
      await settingsPage.selectLanguage("Français");
      await settingsPage.verifySelectedLanguage("Français");

      // The installed app-defaults build renders translated empty-state text on Docs.
      // Its Learning Paths success view only renders card data, so use this shared
      // translation resource to verify locale loading before opening that page.
      await getRhdhSidebarNavigation(guestPage)
        .getByRole("link", { name: "Docs", exact: true })
        .click();
      await expect(
        guestPage.getByText("Aucune documentation disponible", { exact: true }),
      ).toBeVisible();

      await getRhdhSidebarNavigation(guestPage)
        .getByRole("link", { name: /Learning Paths|Parcours d'apprentissage/u })
        .click();

      await expect(guestPage).toHaveURL(/\/learning-paths(?:\?|$)/u);
      await expect(
        guestPage.getByRole("heading", { name: /Learning Paths|Parcours d'apprentissage/u }),
      ).toBeVisible();
      await expect(guestPage.getByText("Building Operators on OpenShift")).toBeVisible();
    },
  );
});
