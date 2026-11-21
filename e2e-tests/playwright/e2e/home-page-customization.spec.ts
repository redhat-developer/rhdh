import { test } from "@support/coverage/test";

import { HomePage } from "../support/pages/home-page";
import { APP_TITLE } from "../support/test-data/branding";
import { runAccessibilityTests } from "../utils/accessibility";

test.describe("Home page customization", () => {
  let homePage: HomePage;

  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
  });

  test.beforeEach(({ guestPage }) => {
    homePage = new HomePage(guestPage);
  });

  // NFS home-page cards are built-in widgets (home-page-widget:home/*, auto-enabled by
  // the homepage plugin — see app.extensions in app-config.local-e2e.yaml / the CI
  // ConfigMap). Arbitrary cards that the legacy OFS dynamicPlugins.frontend mount points
  // used to add (Placeholder, Markdown, Random Joke) have no NFS equivalent or are not
  // auto-enabled — the widgets below are all NFS-native and render by default.
  test(
    "Verify that home page is customized",
    { tag: "@cluster-free-capable" },
    async ({ guestPage }, testInfo) => {
      await homePage.verifyTextInCard("Quick Access", "Quick Access");

      await runAccessibilityTests(guestPage, testInfo);

      await homePage.verifyTextInCard("Featured Docs", "Featured Docs");
      await homePage.verifyTextInCard("Starred Catalog Entities", "Starred Catalog Entities");
    },
  );

  test(
    "Verify that the Top Visited card lists the Home visit under the custom app title",
    { tag: "@cluster-free-capable" },
    async () => {
      await homePage.revisitHome();
      await homePage.verifyVisitedCardContent("Top Visited", APP_TITLE);
    },
  );

  test(
    "Verify that the Recently Visited card lists the Home visit under the custom app title",
    { tag: "@cluster-free-capable" },
    async () => {
      await homePage.revisitHome();
      await homePage.verifyVisitedCardContent("Recently Visited", APP_TITLE);
    },
  );

  test("Verify Customized Quick Access", async () => {
    test.fixme(
      process.env.IS_OPENSHIFT === "false",
      "Requires the OpenShift-only customization provider; restore Kubernetes coverage in RHDHBUGS-4096.",
    );
    // Expanded by default
    await homePage.verifyQuickAccess("Developer Tools", "Podman Desktop");
    await homePage.verifyQuickAccess("CI/CD Tools", ["ArgoCD", "SonarQube", "Quay.io"]);
    await homePage.verifyQuickAccess("OpenShift Clusters", "OpenShift");
    // Collapsed by default
    await homePage.verifyQuickAccess("Monitoring Tools", "Grafana", true);
    await homePage.verifyQuickAccess("Security Tools", ["GitHub Security", "Keycloak"], true);
  });
});
