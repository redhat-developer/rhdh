import { Page } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";

/** Catalog browse and entity list interactions. */
export class CatalogBrowsePage {
  private readonly ui: UIhelper;

  constructor(page: Page) {
    this.ui = new UIhelper(page);
  }

  async openCatalogSidebar(kind?: string): Promise<void> {
    if (kind !== undefined) {
      await this.ui.openCatalogSidebar(kind);
      return;
    }
    await this.ui.openSidebar("Catalog");
  }

  async openSidebar(label: string): Promise<void> {
    await this.ui.openSidebar(label);
  }

  async selectKind(kind: string): Promise<void> {
    await this.ui.selectMuiBox("Kind", kind);
  }

  async verifyComponentsInCatalog(
    kind: string,
    names: string[],
  ): Promise<void> {
    await this.ui.verifyComponentInCatalog(kind, names);
  }

  async verifyTableRows(rows: string[]): Promise<void> {
    await this.ui.verifyRowsInTable(rows);
  }

  async searchCatalog(query: string): Promise<void> {
    await this.ui.searchInputPlaceholder(query);
  }

  async verifyRowByUniqueText(
    text: string,
    columns: string[] | RegExp[],
  ): Promise<void> {
    await this.ui.verifyRowInTableByUniqueText(text, columns);
  }

  async openEntityLink(name: string): Promise<void> {
    await this.ui.clickLink(name);
  }

  async openDependenciesTab(): Promise<void> {
    await this.ui.clickTab("Dependencies");
  }

  async clickButton(label: string): Promise<void> {
    await this.ui.clickButton(label);
  }

  async verifyHeading(heading: string | RegExp): Promise<void> {
    await this.ui.verifyHeading(heading);
  }

  async verifyText(text: string | RegExp, exact = true): Promise<void> {
    await this.ui.verifyText(text, exact);
  }

  async verifyColumnHeading(headings: string[], exact = true): Promise<void> {
    await this.ui.verifyColumnHeading(headings, exact);
  }

  async clickTab(tabName: string): Promise<void> {
    await this.ui.clickTab(tabName);
  }

  async verifyLink(
    label: string,
    options?: { exact?: boolean; notVisible?: boolean },
  ): Promise<void> {
    await this.ui.verifyLink(label, options);
  }

  async clickByDataTestId(dataTestId: string): Promise<void> {
    await this.ui.clickByDataTestId(dataTestId);
  }

  async openSelfServiceFromCatalog(): Promise<void> {
    await this.ui.openSidebar("Catalog");
    await this.ui.clickButton("Self-service");
  }

  async importGitRepositoryFromCatalog(): Promise<void> {
    await this.openSelfServiceFromCatalog();
    await this.ui.clickButton("Import an existing Git repository");
  }

  async verifyTextInSelector(
    selector: string,
    expectedText: string,
  ): Promise<void> {
    await this.ui.verifyTextInSelector(selector, expectedText);
  }

  async verifyPartialTextInSelector(
    selector: string,
    partialText: string,
  ): Promise<void> {
    await this.ui.verifyPartialTextInSelector(selector, partialText);
  }

  async openTemplateFromCatalog(templateName: string): Promise<void> {
    await this.ui.openSidebar("Catalog");
    await this.ui.selectMuiBox("Kind", "Template");
    await this.ui.searchInputPlaceholder(`${templateName}\n`);
    await this.ui.verifyRowInTableByUniqueText(templateName, [templateName]);
    await this.ui.clickLink(templateName);
  }
}
