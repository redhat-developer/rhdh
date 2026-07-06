import { expect, Page } from "@playwright/test";

import * as interaction from "../../utils/ui-helper/interaction";
import * as misc from "../../utils/ui-helper/misc";
import * as navigation from "../../utils/ui-helper/navigation";
import * as table from "../../utils/ui-helper/table";
import * as verification from "../../utils/ui-helper/verification";
import { SEARCH_OBJECTS_COMPONENTS } from "../selectors/page-selectors";
import { findTableCellByColumn } from "../selectors/semantic/table-helpers";

/** Catalog browse and entity list interactions. */
export class CatalogBrowsePage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private async fillSearch(query: string): Promise<void> {
    await this.page.fill(SEARCH_OBJECTS_COMPONENTS.placeholderSearch, query);
  }

  async openCatalogSidebar(kind?: string): Promise<void> {
    if (kind !== undefined) {
      await navigation.openCatalogSidebar(this.page, kind);
      return;
    }
    await navigation.openSidebar(this.page, "Catalog");
  }

  async openSidebar(label: string): Promise<void> {
    await navigation.openSidebar(this.page, label);
  }

  async selectKind(kind: string): Promise<void> {
    await navigation.selectMuiBox(this.page, "Kind", kind);
  }

  async verifyComponentsInCatalog(kind: string, names: string[]): Promise<void> {
    await misc.verifyComponentInCatalog(this.page, kind, names);
  }

  async verifyTableRows(rows: string[]): Promise<void> {
    await verification.verifyRowsInTable(this.page, rows);
  }

  async searchCatalog(query: string): Promise<void> {
    await this.fillSearch(query);
  }

  async verifyRowByUniqueText(text: string, columns: string[] | RegExp[]): Promise<void> {
    await table.verifyRowInTableByUniqueText(this.page, text, columns);
  }

  async openEntityLink(name: string): Promise<void> {
    await interaction.clickLink(this.page, name);
  }

  async openDependenciesTab(): Promise<void> {
    await interaction.clickTab(this.page, "Dependencies");
  }

  async verifyHeading(heading: string | RegExp): Promise<void> {
    await verification.verifyHeading(this.page, heading);
  }

  async verifyText(text: string | RegExp, exact = true): Promise<void> {
    await verification.verifyText(this.page, text, exact);
  }

  async verifyColumnHeading(headings: string[], exact = true): Promise<void> {
    await verification.verifyColumnHeading(this.page, headings, exact);
  }

  async clickTab(tabName: string): Promise<void> {
    await interaction.clickTab(this.page, tabName);
  }

  async verifyLink(
    label: string,
    options?: { exact?: boolean; notVisible?: boolean },
  ): Promise<void> {
    await verification.verifyLink(this.page, label, options);
  }

  async clickByDataTestId(dataTestId: string): Promise<void> {
    await interaction.clickByDataTestId(this.page, dataTestId);
  }

  async openSelfServiceFromCatalog(): Promise<void> {
    await navigation.openSidebar(this.page, "Catalog");
    await interaction.clickButton(this.page, "Self-service");
  }

  async importGitRepositoryFromCatalog(): Promise<void> {
    await this.openSelfServiceFromCatalog();
    await interaction.clickButton(this.page, "Import an existing Git repository");
  }

  async clearSearchIfVisible(): Promise<void> {
    const clearButton = this.page.getByRole("button", { name: "clear search" });
    if (await clearButton.isVisible()) {
      await expect(clearButton).toBeEnabled();
      await clearButton.click();
    }
  }

  async sortCreatedAtDescending(): Promise<void> {
    await expect(
      this.page.getByRole("row").filter({ has: this.page.getByRole("cell") }),
    ).not.toHaveCount(0);

    const column = this.page.getByRole("columnheader", {
      name: "Created At",
      exact: true,
    });
    await column.click();
    await column.click();
  }

  async verifyFirstRowCreatedAtNotEmpty(): Promise<void> {
    const firstRow = this.page
      .getByRole("row")
      .filter({ has: this.page.getByRole("cell") })
      .first();
    const rowText = await firstRow.textContent();
    if (rowText === null || rowText === "") {
      throw new Error("Expected the first catalog row to have text content");
    }
    const createdAtCell = await findTableCellByColumn(this.page, rowText, "Created At");
    await expect(createdAtCell).not.toBeEmpty();
  }

  async openEntityLinkByHref(hrefFragment: string): Promise<void> {
    const link = this.page.locator(`a[href*="${hrefFragment}"]`).first();
    await expect(link).toBeVisible();
    await link.click();
  }

  async verifyTableCell(text: string): Promise<void> {
    await expect(this.page.getByRole("cell", { name: text })).toBeVisible();
  }

  async openLicensedUsersCatalog(): Promise<void> {
    await this.page.goto("/catalog?filters%5Bkind%5D=user&filters%5Buser");
  }

  async verifyDependencyResource(resource: string): Promise<void> {
    const resourceElement = this.page.locator(`#workspace:has-text("${resource}")`);
    await resourceElement.scrollIntoViewIfNeeded();
    await expect(resourceElement).toBeVisible();
  }
}
