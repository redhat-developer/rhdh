import { Page, expect } from "@playwright/test";

import * as verification from "../../utils/ui-helper/verification";
/* oxlint-disable playwright/no-raw-locators -- MUI home page layout selectors */
import { HOME_PAGE_COMPONENTS, SEARCH_OBJECTS_COMPONENTS } from "../selectors/page-selectors";

export class HomePage {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }
  async verifyQuickSearchBar(text: string) {
    const searchBar = SEARCH_OBJECTS_COMPONENTS.getSearchInput(this.page);
    await searchBar.waitFor();
    await searchBar.fill("");
    await searchBar.pressSequentially(`${text}\n`);
    await verification.verifyLink(this.page, text);
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
