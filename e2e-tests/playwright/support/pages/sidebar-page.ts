import { expect, Page } from "@playwright/test";

import { getCurrentLanguage, getTranslations } from "../../e2e/localization/locale";
import { UIhelper } from "../../utils/ui-helper";

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
    await this.openSidebarButton("References");
    await this.openSidebar("Learning Paths");
  }

  async openFavoritesDocs(): Promise<void> {
    await this.openSidebarButton("Favorites");
    await this.openSidebar(t["rhdh"][lang]["menuItem.docs"]);
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
    const sectionMenu = this.getSideBarMenuItem(section);
    await expect(sectionMenu.getByText(itemText)).toBeVisible();
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
