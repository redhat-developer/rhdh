import { expect, Page } from "@playwright/test";

import { getCurrentLanguage, getTranslations } from "../../e2e/localization/locale";
import * as navigation from "../../utils/ui-helper/navigation";
import * as verification from "../../utils/ui-helper/verification";

const t = getTranslations();

/**
 * Sidebar navigation on the RHDH instance.
 *
 * NFS (packages/app) renders a flat, code-defined sidebar
 * (packages/app/src/modules/nav/Sidebar.tsx): Home, Catalog, Learning Paths, and
 * Create are pinned first, everything else (Docs, etc.) is flat and sorted
 * alphabetically by title. There is no config-driven nested grouping (the legacy
 * "References" / "Favorites" menuItems groups have no NFS equivalent).
 */
export class SidebarPage {
  constructor(private readonly page: Page) {}

  async openDocs(): Promise<void> {
    const lang = getCurrentLanguage();
    await navigation.openSidebar(this.page, t["rhdh"][lang]["menuItem.docs"]);
  }

  async openLearningPaths(): Promise<void> {
    const lang = getCurrentLanguage();
    await navigation.openSidebar(this.page, t["rhdh"][lang]["menuItem.learningPaths"]);
  }

  /** Opens a specific entity's TechDocs from the TechDocs index page (must call openDocs() first). */
  async openDocsEntity(entityTitle: string): Promise<void> {
    await this.page.getByRole("link", { name: entityTitle, exact: true }).first().click();
  }

  async verifyDocsHeading(): Promise<void> {
    await verification.verifyHeading(this.page, "Docs");
  }

  async verifyLearningPathsHeading(): Promise<void> {
    await verification.verifyHeading(this.page, "Learning Paths");
  }

  async verifyText(text: string | RegExp, exact = true): Promise<void> {
    await verification.verifyText(this.page, text, exact);
  }

  /** NFS TechDocs reader uses a "Documentation" heading and entity-specific content. */
  async verifyDocsEntityContent(): Promise<void> {
    await verification.verifyHeading(this.page, "Documentation");
    await verification.verifyText(this.page, "Red Hat Developer Hub", false);
  }

  async verifyLearningPathLinksOpenInNewTab(): Promise<void> {
    const learningPathLinks = this.page.getByRole("main").getByRole("link");

    for (const learningPathLink of await learningPathLinks.all()) {
      await expect(learningPathLink).toBeVisible();
      await expect(learningPathLink).toHaveAttribute("target", "_blank");
      await expect(learningPathLink).not.toHaveAttribute("href", "");
    }
  }
}
