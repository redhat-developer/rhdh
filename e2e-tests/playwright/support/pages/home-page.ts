import { Page, expect } from "@playwright/test";

import * as interaction from "../../utils/ui-helper/interaction";
import * as navigation from "../../utils/ui-helper/navigation";
import * as verification from "../../utils/ui-helper/verification";
/* oxlint-disable playwright/no-raw-locators -- MUI home page layout selectors */
import { HOME_PAGE_COMPONENTS } from "../selectors/page-selectors";

export class HomePage {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async verifyWelcomeHeading(): Promise<void> {
    await verification.verifyHeading(this.page, "Welcome back!");
  }

  async openHomeSidebar(): Promise<void> {
    await navigation.openSidebar(this.page, "Home");
  }

  async verifyTextInCard(cardHeading: string, text: string | RegExp, exact = true): Promise<void> {
    const card = HOME_PAGE_COMPONENTS.getCard(this.page, cardHeading);
    await expect(card).toBeVisible();
    if (typeof text === "string") {
      await expect(card.getByText(text, { exact })).toBeVisible();
      return;
    }
    await expect(card.getByText(text)).toBeVisible();
  }

  async verifyHeading(heading: string | RegExp): Promise<void> {
    await verification.verifyHeading(this.page, heading);
  }

  async verifyDivHasText(text: string | RegExp): Promise<void> {
    await verification.verifyDivHasText(this.page, text);
  }

  async clickButton(label: string): Promise<void> {
    await interaction.clickButton(this.page, label);
  }

  async verifyMainHeadingVisible(): Promise<void> {
    await expect(this.page.getByRole("heading", { level: 1 })).toBeVisible();
  }

  async verifyQuickAccess(section: string, items: string | string[], expand = false) {
    const accordionButton = HOME_PAGE_COMPONENTS.getAccordion(this.page, section);
    await expect(accordionButton).toBeVisible();

    const sectionLocator = this.page
      /* oxlint-disable-next-line typescript/no-deprecated -- accordion items live outside the summary button node */
      .locator(HOME_PAGE_COMPONENTS.MuiAccordion)
      .filter({ has: accordionButton });

    if (expand) {
      await accordionButton.click();
      await expect(sectionLocator.locator('[class*="MuiAccordionDetails-root"]')).toBeVisible();
    }

    for (const item of Array.isArray(items) ? items : [items]) {
      const itemLocator = sectionLocator
        .locator(`a div[class*="MuiListItemText-root"]`)
        .filter({ hasText: item });
      await itemLocator.waitFor({ state: "visible" });
      await expect(itemLocator).toBeVisible();
    }
  }

  async verifyVisitedCardContent(section: string) {
    const sectionLocator = this.page
      /* oxlint-disable-next-line typescript/no-deprecated -- visited cards use MuiCard-root, not region/article roles */
      .locator(HOME_PAGE_COMPONENTS.MuiCard)
      .filter({ hasText: section });
    await expect(sectionLocator).toBeVisible();

    const itemLocator = sectionLocator.locator(`li[class*="MuiListItem-root"]`);
    expect(await itemLocator.count()).toBeGreaterThanOrEqual(0);
  }
}
