import { Page, expect } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import { APIHelper } from "../../utils/api-helper";
import { CATALOG_IMPORT_COMPONENTS } from "../page-objects/page-obj";
import {
  getTranslations,
  getCurrentLanguage,
} from "../../e2e/localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();

export class CatalogImport {
  private page: Page;
  private uiHelper: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UIhelper(page);
  }

  /**
   * Fills the component URL input and clicks the "Analyze" button.
   * Waits until the analyze button is no longer visible (processing done).
   *
   * @param url - The URL of the component to analyze
   */
  private async analyzeAndWait(url: string): Promise<void> {
    await this.page.fill(CATALOG_IMPORT_COMPONENTS.componentURL, url);
    await expect(
      await this.uiHelper.clickButton(
        t["catalog-import"][lang]["stepInitAnalyzeUrl.nextButtonText"],
      ),
    ).not.toBeVisible({
      timeout: 25_000,
    });
  }

  /**
   * Returns true if the component is already registered
   * (i.e., "Refresh" button is visible instead of "Import").
   *
   * @returns boolean indicating if the component is already registered
   */
  async isComponentAlreadyRegistered(): Promise<boolean> {
    return await this.uiHelper.isBtnVisible(
      t["catalog-import"][lang]["stepReviewLocation.refresh"],
    );
  }

  /**
   * Registers an existing component if it has not been registered yet.
   * If already registered, clicks the "Refresh" button instead.
   *
   * @param url - The component URL to register
   * @param clickViewComponent - Whether to click "View Component" after import
   */
  async registerExistingComponent(
    url: string,
    clickViewComponent: boolean = true,
  ) {
    await this.analyzeAndWait(url);
    const isComponentAlreadyRegistered =
      await this.isComponentAlreadyRegistered();
    if (isComponentAlreadyRegistered) {
      await this.uiHelper.clickButton(
        t["catalog-import"][lang]["stepReviewLocation.refresh"],
      );
      expect(
        await this.uiHelper.isBtnVisible(
          t["catalog-import"][lang]["stepFinishImportLocation.backButtonText"],
        ),
      ).toBeTruthy();
    } else {
      await this.uiHelper.clickButton(
        t["catalog-import"][lang]["stepReviewLocation.import"],
      );
      if (clickViewComponent) {
        await this.uiHelper.clickButton(
          t["catalog-import"][lang][
            "stepFinishImportLocation.locations.viewButtonText"
          ],
        );
      }
    }
    return isComponentAlreadyRegistered;
  }

  async analyzeComponent(url: string) {
    await this.page.fill(CATALOG_IMPORT_COMPONENTS.componentURL, url);
    await this.uiHelper.clickButton(
      t["catalog-import"][lang]["stepInitAnalyzeUrl.nextButtonText"],
    );
  }

  async inspectEntityAndVerifyYaml(text: string) {
    await this.page.getByTitle("More").click();
    await this.page.getByRole("menuitem").getByText("Inspect entity").click();
    await this.uiHelper.clickTab("Raw YAML");
    await expect(this.page.getByTestId("code-snippet")).toContainText(text);
    await this.uiHelper.clickButton("Close");
  }
}

export class BackstageShowcase {}
