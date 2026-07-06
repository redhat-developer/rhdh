import { expect, Page } from "@playwright/test";

import { getCurrentLanguage, getTranslations } from "../../e2e/localization/locale";
import { UIhelper } from "../../utils/ui-helper";
import { expectSidebarLinkVisible } from "../../utils/ui-helper/navigation";

const t = getTranslations();
const lang = getCurrentLanguage();

/** Sidebar navigation on the RHDH instance. */
export class SidebarPage {
  private readonly page: Page;
  private readonly ui: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.ui = new UIhelper(page);
  }

  getSideBarMenuItem(name: string) {
    return this.ui.getSideBarMenuItem(name);
  }

  async openSidebar(label: string): Promise<void> {
    await this.ui.openSidebar(label);
  }

  async openSidebarButton(label: string): Promise<void> {
    await this.ui.openSidebarButton(label);
  }

  async openReferencesLearningPaths(): Promise<void> {
    // Legacy cluster-free app uses a flat References group; the full
    // openSidebarLinkInSection helper targets CI sidebar overlays instead.
    await this.ui.openSidebarButton("References");
    await this.ui.openSidebar("Learning Paths");
  }

  async openFavoritesDocs(): Promise<void> {
    await this.ui.openSidebarLinkInSection("Favorites", t["rhdh"][lang]["menuItem.docs"]);
  }

  async verifyDocumentationHeading(): Promise<void> {
    await this.ui.verifyHeading("Documentation");
  }

  async verifyText(text: string | RegExp, exact = true): Promise<void> {
    await this.ui.verifyText(text, exact);
  }

  async verifyLinkHidden(name: string): Promise<void> {
    await expect(this.page.getByRole("link", { name })).toBeHidden();
  }

  async verifyMenuItemInSection(section: string, itemText: string): Promise<void> {
    await expectSidebarLinkVisible(this.page, itemText, section);
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
