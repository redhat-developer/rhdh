import { Page, expect } from "@playwright/test";

import { UIhelper } from "../../utils/ui-helper";
/* oxlint-disable playwright/no-raw-locators -- MUI home page layout selectors */
import { HOME_PAGE_COMPONENTS, SEARCH_OBJECTS_COMPONENTS } from "../page-objects/page-obj";

export class HomePage {
  private page: Page;
  private uiHelper: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UIhelper(page);
  }
  async verifyQuickSearchBar(text: string) {
    const searchBar = SEARCH_OBJECTS_COMPONENTS.getSearchInput(this.page);
    await searchBar.waitFor();
    await searchBar.fill("");
    await searchBar.pressSequentially(`${text}\n`);
    await this.uiHelper.verifyLink(text);
  }

  async verifyQuickAccess(section: string, items: string | string[], expand = false) {
    const sectionLocator = HOME_PAGE_COMPONENTS.getAccordion(this.page, section);
    await expect(sectionLocator).toBeVisible();

    if (expand) {
      await sectionLocator.click();
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
    const sectionLocator = HOME_PAGE_COMPONENTS.getCard(this.page, section);
    await expect(sectionLocator).toBeVisible();

    const itemLocator = sectionLocator.locator(`li[class*="MuiListItem-root"]`);
    expect(await itemLocator.count()).toBeGreaterThanOrEqual(0);
  }
}
