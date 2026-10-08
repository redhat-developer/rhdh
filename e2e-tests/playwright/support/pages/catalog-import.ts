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

  async verifyEntityYaml(text: string) {
    await expect(this.page.getByRole("alert").filter({ hasText: "Entity not found" })).toBeHidden({
      timeout: 60_000,
    });

    // The catalog inspector is addressable even when a custom entity header has no menu actions.
    const inspectUrl = new URL(this.page.url());
    inspectUrl.searchParams.set("inspect", "yaml");
    await this.page.goto(inspectUrl.toString());
    const inspector = this.page
      .getByRole("dialog")
      .filter({ has: this.page.getByRole("heading", { name: "Entity Inspector" }) });
    await expect(inspector).toBeVisible({ timeout: 30_000 });
    await expect(inspector.getByTestId("code-snippet")).toContainText(text);

    // Toast "Request failed with 404" Close buttons match first(); scope to the inspector.
    await inspector.getByRole("button", { name: "Close" }).click();
    await expect(inspector).toBeHidden();
  }
}

export { RhdhInstance } from "./rhdh-instance";
