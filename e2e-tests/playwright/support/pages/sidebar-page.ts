import { Page } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import {
  getCurrentLanguage,
  getTranslations,
} from "../../e2e/localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();

/** Sidebar navigation on the RHDH instance. */
export class SidebarPage {
  private readonly ui: UIhelper;

  constructor(page: Page) {
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
}
