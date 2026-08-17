import { Page } from "@playwright/test";

import * as interaction from "../../utils/ui-helper/interaction";
import * as navigation from "../../utils/ui-helper/navigation";
import * as verification from "../../utils/ui-helper/verification";

/** Self-service / scaffolder template list interactions. */
export class SelfServicePage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await navigation.goToSelfServicePage(this.page);
  }

  async verifyTemplatesHeading(): Promise<void> {
    await verification.verifyHeading(this.page, "Templates");
  }

  async clickImportGitRepository(): Promise<void> {
    await interaction.clickButton(this.page, "Import an existing Git repository");
  }

  async clickImportGitRepositoryLocalized(buttonTitle: string): Promise<void> {
    await interaction.clickButton(this.page, buttonTitle);
  }

  async waitForTemplateTitle(template: string, level = 4): Promise<void> {
    await verification.waitForTitle(this.page, template, level);
  }

  async verifyTemplateHeading(template: string): Promise<void> {
    await verification.verifyHeading(this.page, template);
  }
}
