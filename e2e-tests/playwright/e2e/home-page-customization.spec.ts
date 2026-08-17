import { test } from "@support/coverage/test";

import { HomePage } from "../support/pages/home-page";
import { RhdhHomePage } from "../support/pages/rhdh-home-page";
import { runAccessibilityTests } from "../utils/accessibility";
import { Common } from "../utils/common";

test.describe("Home page customization", () => {
  let common: Common;
  let rhdhHomePage: RhdhHomePage;
  let homePage: HomePage;

  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
  });

  test.beforeEach(async ({ page }) => {
    rhdhHomePage = new RhdhHomePage(page);
    common = new Common(page);
    homePage = new HomePage(page);
    await common.loginAsGuest();
  });

  // @cluster-free: verified green on the cluster-free harness (playwright.local.config.ts)
  //
  // NFS home-page cards are built-in widgets (home-page-widget:home/*, auto-enabled by
  // the homepage plugin — see app.extensions in app-config.local-e2e.yaml / the CI
  // ConfigMap). Arbitrary cards that the legacy OFS dynamicPlugins.frontend mount points
  // used to add (Placeholder, Markdown, Random Joke) have no NFS equivalent or are not
  // auto-enabled — the widgets below are all NFS-native and render by default.
  test(
    "Verify that home page is customized",
    { tag: "@cluster-free" },
    async ({ page }, testInfo) => {
      await rhdhHomePage.verifyTextInCard("Quick Access", "Quick Access");

      await runAccessibilityTests(page, testInfo);

      await rhdhHomePage.verifyTextInCard("Featured Docs", "Featured Docs");
      await rhdhHomePage.verifyTextInCard("Starred Catalog Entities", "Starred Catalog Entities");
    },
  );

  test(
    "Verify that the Top Visited card in the Home page renders without an error",
    { tag: "@cluster-free" },
    async () => {
      await rhdhHomePage.verifyTextInCard("Top Visited", "Top Visited");
      await homePage.verifyVisitedCardContent("Top Visited");
    },
  );

  test(
    "Verify that the Recently Visited card in the Home page renders without an error",
    { tag: "@cluster-free" },
    async () => {
      await rhdhHomePage.verifyTextInCard("Recently Visited", "Recently Visited");
      await homePage.verifyVisitedCardContent("Recently Visited");
    },
  );

  test("Verify Customized Quick Access", async () => {
    // Expanded by default
    await homePage.verifyQuickAccess("Developer Tools", "Podman Desktop");
    await homePage.verifyQuickAccess("CI/CD Tools", ["ArgoCD", "SonarQube", "Quay.io"]);
    await homePage.verifyQuickAccess("OpenShift Clusters", "OpenShift");
    // Collapsed by default
    await homePage.verifyQuickAccess("Monitoring Tools", "Grafana", true);
    await homePage.verifyQuickAccess("Security Tools", ["GitHub Security", "Keycloak"], true);
  });
});
