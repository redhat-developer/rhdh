import { test } from "@support/coverage/test";

import { SidebarPage } from "../../../support/pages/sidebar-page";
import { Common } from "../../../utils/common";

test.describe("Validate Sidebar Navigation Customization", { tag: "@layer3-equivalent" }, () => {
  let sidebarPage: SidebarPage;
  let common: Common;

  test.beforeEach(async ({ page }) => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });

    sidebarPage = new SidebarPage(page);
    common = new Common(page);

    await common.loginAsGuest();
  });

  // @cluster-free: verified green on the cluster-free harness (playwright.local.config.ts)
  //
  // NFS's sidebar (packages/app/src/modules/nav/Sidebar.tsx) is a fixed, code-defined
  // flat nav — there is no config-driven equivalent of the legacy nested "References" /
  // "Favorites" menuItems groups or the synthetic "Test enabled/disabled" /
  // "Test_i enabled/disabled" items (they had no backing page, only a Scalprum mount
  // point). This only verifies real, flat-nav behavior: the Docs (TechDocs) sidebar
  // item navigates to the TechDocs index page (NFS PageBlueprint title: "Docs", not
  // the legacy OFS pageWrapper.title "Documentation"). It stops there — the cluster-free
  // harness's catalog (e2e-tests/local-harness/guest-ownership-entities.yaml) has no
  // backstage.io/techdocs-ref-annotated entities, so the index is always empty here;
  // see "Verify Docs entity page renders real content" below for the full-content check.
  test("Verify Docs sidebar navigation", { tag: "@cluster-free" }, async () => {
    await sidebarPage.openDocs();

    await sidebarPage.verifyDocsHeading();
  });

  // @cluster-free: verified green on the cluster-free harness (playwright.local.config.ts)
  //
  // Learning Paths is pinned in the NFS sidebar (page:app/learning-paths) between
  // Catalog and Create — not nested under the legacy "References" group.
  test("Verify Learning Paths sidebar navigation", { tag: "@cluster-free" }, async () => {
    await sidebarPage.openLearningPaths();

    await sidebarPage.verifyLearningPathsHeading();
  });

  // Not @cluster-free: needs a real techdocs-ref entity with buildable/published docs
  // content — e.g. catalog-entities/components/showcase.yaml's "Red Hat Developer Hub"
  // (techdocs-ref: url:...), loaded via catalog-entities/all.yaml (app-config.yaml) in
  // full CI only. The cluster-free harness's catalog has no such entity (see above), so
  // this can't run there.
  test("Verify Docs entity page renders real content", async () => {
    await sidebarPage.openDocs();
    await sidebarPage.openDocsEntity("Red Hat Developer Hub");
    await sidebarPage.verifyText("Documentation available in", false);
  });
});
