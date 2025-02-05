import { HOME_PAGE_COMPONENTS } from "../pageObjects/page-obj";
import { UiHelper } from "../../utils/ui-helper";
import { Page, expect } from "@playwright/test";

export class HomePage {
  private page: Page;
  private uiHelper: UiHelper;

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UiHelper(page);
  }
  async verifyQuickSearchBar(text: string) {
    const searchBar = this.page.locator(HOME_PAGE_COMPONENTS.searchBar);
    await searchBar.waitFor();
    await searchBar.fill("");
    await searchBar.type(text + "\n"); // '\n' simulates pressing the Enter key
    await this.uiHelper.verifyLink(text);
  }

  async verifyQuickAccess(
    section: string,
    quickAccessItem: string,
    expand = false,
  ) {
    await this.page.waitForSelector(HOME_PAGE_COMPONENTS.MuiAccordion, {
      state: "visible",
    });

    const sectionLocator = this.page
      .locator(HOME_PAGE_COMPONENTS.MuiAccordion)
      .filter({ hasText: section });

    if (expand) {
      await sectionLocator.click();
      await this.page.waitForTimeout(500);
    }

    const itemLocator = sectionLocator
      .locator(`a div[class*="MuiListItemText-root"]`)
      .filter({ hasText: quickAccessItem });

    await itemLocator.waitFor({ state: "visible" });

    const isVisible = await itemLocator.isVisible();
    expect(isVisible).toBeTruthy();
  }
}
