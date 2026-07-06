import { Page } from "@playwright/test";

import { UIhelper } from "../../utils/ui-helper";

/** Self-service / scaffolder template list interactions. */
export class SelfServicePage {
  private readonly ui: UIhelper;

  constructor(page: Page) {
    this.ui = new UIhelper(page);
  }

  async open(): Promise<void> {
    await this.ui.goToSelfServicePage();
  }

  async verifyTemplatesHeading(): Promise<void> {
    await this.ui.verifyHeading("Templates");
  }

  async clickImportGitRepository(): Promise<void> {
    await this.ui.clickButton("Import an existing Git repository");
  }

  async clickImportGitRepositoryLocalized(buttonTitle: string): Promise<void> {
    await this.ui.clickButton(buttonTitle);
  }

  async waitForTemplateTitle(template: string, level = 4): Promise<void> {
    await this.ui.waitForTitle(template, level);
  }

  async verifyHeading(heading: string): Promise<void> {
    await this.ui.verifyHeading(heading);
  }

  async clickButton(label: string): Promise<void> {
    await this.ui.clickButton(label);
  }

  async searchTemplate(name: string): Promise<void> {
    await this.ui.searchInputPlaceholder(name);
  }

  async verifyTemplateHeading(template: string): Promise<void> {
    await this.ui.verifyHeading(template);
  }

  async verifyText(text: string, exact = true): Promise<void> {
    await this.ui.verifyText(text, exact);
  }
}
