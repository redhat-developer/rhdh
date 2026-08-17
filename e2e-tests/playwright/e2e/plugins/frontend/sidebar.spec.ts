import { test } from "@support/coverage/test";

import { SidebarPage } from "../../../support/pages/sidebar-page";

test.describe("Validate Sidebar Navigation Customization", { tag: "@layer3-equivalent" }, () => {
  let sidebarPage: SidebarPage;

  test.beforeAll(({ rhdhGuestPage }) => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });

    sidebarPage = new SidebarPage(rhdhGuestPage);
  });

  // NFS's sidebar (packages/app/src/modules/nav/Sidebar.tsx) is a fixed, code-defined
  // flat nav — there is no config-driven equivalent of the legacy nested "References" /
  // "Favorites" menuItems groups. This verifies flat-nav behavior: the Docs (TechDocs)
  // sidebar item navigates to the TechDocs index page (NFS PageBlueprint title: "Docs",
  // not the legacy OFS pageWrapper.title "Documentation"). It stops there — the
  // cluster-free harness's catalog has no techdocs-ref-annotated entities, so the index
  // is always empty here; see "Verify Docs entity page renders real content" below.
  test("Verify Docs sidebar navigation", { tag: "@cluster-free-capable" }, async () => {
    await sidebarPage.openDocs();

    await sidebarPage.verifyDocsHeading();
  });

  // Learning Paths is pinned in the NFS sidebar (page:app/learning-paths) between
  // Catalog and Create — not nested under the legacy "References" group.
  test("Verify Learning Paths sidebar navigation", { tag: "@cluster-free-capable" }, async () => {
    await sidebarPage.openLearningPaths();

    await sidebarPage.verifyLearningPathsHeading();
  });

  // Not @cluster-free-capable: needs a real techdocs-ref entity with buildable/published docs
  // content — e.g. catalog-entities/components/showcase.yaml's "Red Hat Developer Hub"
  // (techdocs-ref: url:...), loaded via catalog-entities/all.yaml (app-config.yaml) in
  // full CI only. The cluster-free harness's catalog has no such entity, so this can't run there.
  test("Verify Docs entity page renders real content", async () => {
    await sidebarPage.openDocs();
    await sidebarPage.openDocsEntity("Red Hat Developer Hub");
    await sidebarPage.verifyText("Documentation available in", false);
  });
});
