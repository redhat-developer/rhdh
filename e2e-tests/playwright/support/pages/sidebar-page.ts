import { expect, Page } from "@playwright/test";

import { getCurrentLanguage, getTranslations } from "../../e2e/localization/locale";
import * as navigation from "../../utils/ui-helper/navigation";
import * as verification from "../../utils/ui-helper/verification";
import { ensureLegacySectionExpanded } from "../navigation/legacy-sidebar-adapter";

const t = getTranslations();
const lang = getCurrentLanguage();

/** Sidebar navigation on the RHDH instance. */
export class SidebarPage {
  constructor(private readonly page: Page) {}

  async openSidebar(label: string): Promise<void> {
    await navigation.openSidebar(this.page, label);
  }

  async openSidebarButton(label: string, childItemText?: string): Promise<void> {
    await navigation.openSidebarButton(this.page, label, childItemText);
  }

  async openReferencesLearningPaths(): Promise<void> {
    const learningPaths = t["rhdh"][lang]["menuItem.learningPaths"];
    await ensureLegacySectionExpanded(this.page, "References", learningPaths);
    await this.openSidebar(learningPaths);
  }

  async openFavoritesDocs(): Promise<void> {
    await this.openSidebarButton("Favorites");
    await this.openSidebar(t["rhdh"][lang]["menuItem.docs"]);
  }

  async verifyDocumentationHeading(): Promise<void> {
    await verification.verifyHeading(this.page, "Documentation");
  }

  async verifyText(text: string | RegExp, exact = true): Promise<void> {
    await verification.verifyText(this.page, text, exact);
  }

  async verifyLinkHidden(name: string): Promise<void> {
    await expect(this.page.getByRole("link", { name })).toBeHidden();
  }

  async verifyMenuItemInSection(section: string, itemText: string): Promise<void> {
    await ensureLegacySectionExpanded(this.page, section, itemText);
    // Intentional divergence: nested menu items are nav links, not login-button text descendants.
    await expect(this.page.locator(`nav a:has-text("${itemText}")`).first()).toBeVisible();
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
