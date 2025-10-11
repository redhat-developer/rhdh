import { Page, expect, Locator } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";

export class Extensions {
  private page: Page;
  public badge: Locator;
  private uiHelper: UIhelper;

  private commonHeadings = [
    "Versions",
    "Author",
    "Tags",
    "Category",
    "Publisher",
    "Support Provider",
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

  async clickReadMoreByPluginTitle(pluginTitle: string) {
    const allCards = this.page.locator(".v5-MuiPaper-outlined");
    const targetCard = allCards.filter({ hasText: pluginTitle });
    await targetCard.getByRole("link", { name: "Read more" }).click();
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
    await this.selectDropdown("Support type");
    await this.toggleOption(supportType);
    await this.page.keyboard.press("Escape");
  }

  async resetSupportTypeFilter(supportType: string) {
    await this.selectDropdown("Support type");
    await this.toggleOption(supportType);
    await this.page.keyboard.press("Escape");
  }

  async verifyMultipleHeadings(headings: string[] = this.commonHeadings) {
    for (const heading of headings) {
      console.log(`Verifying heading: ${heading}`);
      await this.uiHelper.verifyHeading(heading);
    }
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
    await this.page.getByRole("heading", { name: pluginName }).first().click();
    await expect(
      this.page.getByLabel(badgeLabel).getByText(badgeText),
    ).toBeVisible();

    if (includeAbout) {
      await this.uiHelper.verifyText("About");
    }

    await this.verifyMultipleHeadings(headings);

    if (includeTable) {
      await this.uiHelper.verifyTableHeadingAndRows(this.tableHeaders);
    }

    await this.page.getByRole("button", { name: "close" }).click();
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
}
