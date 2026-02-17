import { Page, expect, Locator } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import {
  getTranslations,
  getCurrentLanguage,
} from "../../e2e/localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();

export class Extensions {
  private page: Page;
  public badge: Locator;
  private uiHelper: UIhelper;

  private commonHeadings = [
    t["plugin.extensions"][lang]["metadata.versions"],
    t["plugin.extensions"][lang]["search.author"],
    t["plugin.extensions"][lang]["package.tags"],
    t["plugin.extensions"][lang]["metadata.category"],
    t["plugin.extensions"][lang]["metadata.publisher"],
    t["plugin.extensions"][lang]["metadata.supportProvider"],
  ];
  private tableHeaders = [
    "Package name",
    "Version",
    "Role",
    "Backstage compatibility version",
    "Status",
  ];

  constructor(page: Page) {
    this.page = page;
    this.badge = this.page.getByTestId("TaskAltIcon");
    this.uiHelper = new UIhelper(page);
  }

  async clickReadMoreByPluginTitle(pluginTitle: string, badgeText: string) {
    const allCards = this.page.locator(".v5-MuiPaper-outlined");
    const targetCard = allCards.filter({ hasText: pluginTitle });
    await targetCard
      .getByRole("link", {
        name: t["plugin.extensions"][lang]["common.readMore"],
      })
      .click();
    await expect(
      this.page.getByText(pluginTitle + " by Red Hat" + badgeText, {
        exact: true,
      }),
    ).toBeVisible();
  }

  async selectDropdown(name: string) {
    await this.page
      .getByLabel(name)
      .getByRole("button", { name: "Open" })
      .click();
  }

  async toggleOption(name: string) {
    await this.page
      .getByRole("option", { name: name })
      .getByRole("checkbox")
      .click();
  }

  async clickAway() {
    await this.page.locator("#menu- div").first().click();
  }

  async selectSupportTypeFilter(supportType: string) {
    await this.selectDropdown(
      t["plugin.extensions"][lang]["search.supportType"],
    );
    await this.toggleOption(supportType);
    await this.page.keyboard.press("Escape");
  }

  async resetSupportTypeFilter(supportType: string) {
    await this.selectDropdown(
      t["plugin.extensions"][lang]["search.supportType"],
    );
    await this.toggleOption(supportType);
    await this.page.keyboard.press("Escape");
  }

  async verifyMultipleHeadings(headings: string[] = this.commonHeadings) {
    for (const heading of headings) {
      console.log(`Verifying heading: ${heading}`);
      await this.uiHelper.verifyHeading(heading);
    }
  }

  async waitForSearchResults(searchText: string) {
    await this.uiHelper.verifyHeading("Plugins (1)");
    await expect(
      this.page.locator(".v5-MuiPaper-outlined").first(),
    ).toContainText(searchText, { timeout: 10000 });
  }

  async verifyPluginDetails({
    pluginName,
    badgeLabel,
    badgeText,
    headings = this.commonHeadings,
    includeTable = true,
    includeAbout = false,
  }: {
    pluginName: string;
    badgeLabel: string;
    badgeText: string;
    headings?: string[];
    includeTable?: boolean;
    includeAbout?: boolean;
  }) {
    await this.clickReadMoreByPluginTitle(pluginName, badgeText);
    await expect(
      this.page.getByLabel(badgeLabel).getByText(badgeText),
    ).toBeVisible();

    if (includeAbout) {
      await this.uiHelper.verifyText(
        t["plugin.extensions"][lang]["metadata.about"],
      );
    }

    await this.verifyMultipleHeadings(headings);

    if (includeTable) {
      await this.uiHelper.verifyTableHeadingAndRows(this.tableHeaders);
    }

    await this.page
      .getByRole("button", {
        name: "close",
      })
      .click();
  }

  async verifySupportTypeBadge({
    supportType,
    pluginName,
    badgeLabel,
    badgeText,
    tooltipText,
    searchTerm,
    headings = this.commonHeadings,
    includeTable = true,
    includeAbout = false,
  }: {
    supportType: string;
    pluginName?: string;
    badgeLabel: string;
    badgeText: string;
    tooltipText: string;
    searchTerm?: string;
    headings?: string[];
    includeTable?: boolean;
    includeAbout?: boolean;
  }) {
    await this.selectSupportTypeFilter(supportType);

    if (searchTerm) {
      await this.uiHelper.searchInputPlaceholder(searchTerm);
      await this.waitForSearchResults(searchTerm);
    }

    if (pluginName) {
      await this.verifyPluginDetails({
        pluginName,
        badgeLabel,
        badgeText,
        headings,
        includeTable,
        includeAbout,
      });
    } else {
      await expect(this.page.getByLabel(badgeLabel).first()).toBeVisible();
      await expect(this.badge.first()).toBeVisible();
      await this.badge.first().hover();
      await this.uiHelper.verifyTextInTooltip(tooltipText);
    }

    await this.resetSupportTypeFilter(supportType);
  }

  async verifyKeyValueRowElements(rowTitle: string, rowValue: string) {
    const rowLocator = this.page.locator(".v5-MuiTableRow-root");
    await expect(rowLocator.filter({ hasText: rowTitle })).toContainText(
      rowValue,
    );
  }
}
