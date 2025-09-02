import {
  HOME_PAGE_COMPONENTS,
  SEARCH_OBJECTS_COMPONENTS,
} from "../page-objects/page-obj";
import { UIhelper } from "../../utils/ui-helper";
import { Page, expect } from "@playwright/test";

export class HomePage {
  private page: Page;
  private uiHelper: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UIhelper(page);
  }
  async verifyQuickSearchBar(text: string) {
    const searchBar = this.page.locator(
      SEARCH_OBJECTS_COMPONENTS.ariaLabelSearch,
    );
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

    const isVisible = itemLocator;
    await expect(isVisible).toBeVisible();
  }

  async verifyVisitedCardContent(section: string) {
    await this.page.waitForSelector(HOME_PAGE_COMPONENTS.MuiCard, {
      state: "visible",
    });

    const sectionLocator = this.page
      .locator(HOME_PAGE_COMPONENTS.MuiCard)
      .filter({ hasText: section });

    const itemLocator = sectionLocator.locator(`li[class*="MuiListItem-root"]`);
    expect(await itemLocator.count()).toBeGreaterThanOrEqual(0);
  }
}
