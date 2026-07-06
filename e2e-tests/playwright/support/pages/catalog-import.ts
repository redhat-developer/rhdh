import { Page, expect } from "@playwright/test";

import { getTranslations, getCurrentLanguage } from "../../e2e/localization/locale";
import * as interaction from "../../utils/ui-helper/interaction";
import { CATALOG_IMPORT_COMPONENTS } from "../selectors/page-selectors";

const t = getTranslations();
const lang = getCurrentLanguage();

export class CatalogImport {
  constructor(private readonly page: Page) {}

  /**
   * Fills the component URL input and clicks the "Analyze" button.
   * Waits until the analyze button is no longer visible (processing done).
   *
   * @param url - The URL of the component to analyze
   */
  private async analyzeAndWait(url: string): Promise<void> {
    const analyzeButton = this.page.getByRole("button", {
      name: t["catalog-import"][lang]["stepInitAnalyzeUrl.nextButtonText"],
    });
    await this.page.fill(CATALOG_IMPORT_COMPONENTS.componentURL, url);
    await analyzeButton.click();
    await expect(analyzeButton).not.toBeVisible({ timeout: 25_000 });
  }

  /**
   * Returns true if the component is already registered
   * (i.e., "Refresh" button is visible instead of "Import").
   *
   * @returns boolean indicating if the component is already registered
   */
  isComponentAlreadyRegistered(): Promise<boolean> {
    return this.page
      .getByRole("button", { name: t["catalog-import"][lang]["stepReviewLocation.refresh"] })
      .isVisible();
  }

  /**
   * Registers an existing component if it has not been registered yet.
   * If already registered, clicks the "Refresh" button instead.
   *
   * @param url - The component URL to register
   * @param clickViewComponent - Whether to click "View Component" after import
   */
  async registerExistingComponent(url: string, clickViewComponent: boolean = true) {
    await this.analyzeAndWait(url);
    const isComponentAlreadyRegistered = await this.isComponentAlreadyRegistered();
    if (isComponentAlreadyRegistered) {
      await interaction.clickButton(
        this.page,
        t["catalog-import"][lang]["stepReviewLocation.refresh"],
      );
      await expect(
        this.page.getByRole("button", {
          name: t["catalog-import"][lang]["stepFinishImportLocation.backButtonText"],
        }),
      ).toBeVisible();
    } else {
      await interaction.clickButton(
        this.page,
        t["catalog-import"][lang]["stepReviewLocation.import"],
      );
      if (clickViewComponent) {
        await interaction.clickButton(
          this.page,
          t["catalog-import"][lang]["stepFinishImportLocation.locations.viewButtonText"],
        );
      }
    }
    return isComponentAlreadyRegistered;
  }

  async inspectEntityAndVerifyYaml(text: string) {
    await this.page.getByTitle("More").click();
    await this.page.getByRole("menuitem").getByText("Inspect entity").click();
    await interaction.clickTab(this.page, "Raw YAML");
    await expect(this.page.getByTestId("code-snippet")).toContainText(text);
    await interaction.clickButton(this.page, "Close");
  }
}

export { RhdhInstance } from "./rhdh-instance";
