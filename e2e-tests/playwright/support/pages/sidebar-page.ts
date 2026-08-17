import { expect, Page } from "@playwright/test";

import { getCurrentLanguage, getTranslations } from "../../e2e/localization/locale";
import { UIhelper } from "../../utils/ui-helper";

const t = getTranslations();
const lang = getCurrentLanguage();

/**
 * Sidebar navigation on the RHDH instance.
 *
 * NFS (packages/app, default) renders a flat, code-defined sidebar
 * (packages/app/src/modules/nav/Sidebar.tsx): Home, Catalog, Learning Paths, and
 * Create are pinned first, everything else (Docs, etc.) is flat and sorted
 * alphabetically by title. There is no config-driven nested grouping (the legacy
 * "References" / "Favorites" menuItems groups have no NFS equivalent), so this class
 * only exposes flat-nav helpers.
 */
export class SidebarPage {
  private readonly page: Page;
  private readonly ui: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.ui = new UIhelper(page);
  }

  async openDocs(): Promise<void> {
    await this.ui.openSidebar(t["rhdh"][lang]["menuItem.docs"]);
  }

  async openLearningPaths(): Promise<void> {
    await this.ui.openSidebar(t["rhdh"][lang]["menuItem.learningPaths"]);
  }

  /** Opens a specific entity's TechDocs from the TechDocs index page (must call openDocs() first). */
  async openDocsEntity(entityTitle: string): Promise<void> {
    await this.page.getByRole("link", { name: entityTitle, exact: true }).first().click();
  }

  async verifyDocsHeading(): Promise<void> {
    await this.ui.verifyHeading("Docs");
  }

  async verifyLearningPathsHeading(): Promise<void> {
    await this.ui.verifyHeading("Learning Paths");
  }

  async verifyText(text: string | RegExp, exact = true): Promise<void> {
    await this.ui.verifyText(text, exact);
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
