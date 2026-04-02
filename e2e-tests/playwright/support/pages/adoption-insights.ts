import { Page, expect, Locator } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";

export class TestHelper {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async selectOption(optionName: string) {
    const option = this.page.getByRole("option", { name: optionName });
    await option.click();
  }

  async clickByText(text: string) {
    const element = this.page.getByText(text);
    await element.waitFor({ state: "visible" });
    await element.click();
  }

  async getCountFromPanel(panel: Locator): Promise<number | null> {
    try {
      const fullText = await panel
        .locator("h5.v5-MuiTypography-root")
        .textContent();
      const match = fullText?.match(/\d+/);

      if (match) {
        return parseInt(match[0], 10);
      }

      return null; // or 0 if you'd prefer a default
    } catch (error) {
      console.error("Error getting count from panel:", error);
      return null;
    }
  }

  async getVisibleFirstRowText(panel: Locator): Promise<string[]> {
    const firstRow = panel.locator("table.v5-MuiTable-root tbody tr").first();

    if (await firstRow.isVisible()) {
      const cells = firstRow.locator("td");
      const cellCount = await cells.count();
      const texts: string[] = [];

      for (let i = 0; i < cellCount; i++) {
        const cellText = await cells.nth(i).textContent();
        texts.push(cellText?.trim() ?? "");
      }

      // Return first and last elements
      return [texts[0], texts[texts.length - 1]];
    }
    return [];
  }

  async populateMissingPanelData(
    page: Page,
    uiHelper: UIhelper,
    templatesFirstLast: string[] | undefined,
    catalogEntitiesFirstLast: string[] | undefined,
    techdocsFirstLast: string[] | undefined,
  ): Promise<void> {
    if (!templatesFirstLast?.length) {
      // Navigate to a template scaffolder form to generate a template analytics event
      await page.goto("/create/templates/default/techdocs-template");
      await page.waitForLoadState("domcontentloaded");
      // The techdocs-template has no required fields, so click Create directly
      const createBtn = page.getByRole("button", { name: "Create" });
      await createBtn.waitFor({ state: "visible", timeout: 15000 });
      await createBtn.click();
      await page
        .getByText("Run of")
        .first()
        .waitFor({ state: "visible", timeout: 30000 });
      await page.waitForTimeout(5000); // wait for the flush interval to be sure
    }

    if (!catalogEntitiesFirstLast?.length) {
      // Visit any catalog entity to generate an analytics event
      await page.goto("/catalog");
      await page.waitForLoadState("domcontentloaded");
      const firstEntityLink = page
        .locator("table tbody tr td:first-child a")
        .first();
      await firstEntityLink.waitFor({ state: "visible", timeout: 30000 });
      await firstEntityLink.click();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(5000); // wait for the flush interval to be sure
    }

    if (!techdocsFirstLast?.length) {
      // Visit any techdoc to generate an analytics event
      await page.goto("/docs");
      await page.waitForLoadState("domcontentloaded");
      const firstDocLink = page
        .locator("table tbody tr td:first-child a")
        .first();
      await firstDocLink.waitFor({ state: "visible", timeout: 30000 });
      await firstDocLink.click();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(5000); // wait for the flush interval to be sure
    }
  }

  async expectTopEntriesToBePresent(panelTitle: string) {
    const panel = this.page.locator(".v5-MuiPaper-root", {
      hasText: panelTitle,
    });
    const entries = panel.locator("tbody").locator("tr");
    // Use auto-retrying assertion instead of instant count check
    await expect(entries.first()).toBeVisible({ timeout: 30000 });
  }

  async clickAndVerifyText(
    firstEntry: Locator,
    expectedText: string,
  ): Promise<void> {
    const [newpage] = await Promise.all([
      this.page.waitForEvent("popup"),
      firstEntry.locator("a").click(),
    ]);
    // Wait for the expected API call to succeed
    await this.waitUntilApiCallSucceeds(newpage);

    await newpage
      .getByText(expectedText)
      .first()
      .waitFor({ state: "visible", timeout: 30000 });
    await newpage.waitForTimeout(5000); // wait for the flush interval to be sure
    await newpage.close();
  }

  async waitUntilApiCallSucceeds(
    page: Page,
    urlPart: string = "/api/adoption-insights/events",
  ): Promise<void> {
    const response = await page.waitForResponse(
      async (response) => {
        const urlMatches = response.url().includes(urlPart);
        const isSuccess = response.status() === 200;
        return urlMatches && isSuccess;
      },
      { timeout: 60000 },
    );

    expect(response.status()).toBe(200);
  }

  async waitUntilApiCallIsMade(page: Page, urlPart: string): Promise<void> {
    await page.waitForResponse((response) => response.url().includes(urlPart), {
      timeout: 60000,
    });
  }

  async waitForPanelApiCalls(page: Page): Promise<void> {
    const types = [
      "active_users",
      "total_users",
      "top_templates",
      "top_catalog_entities",
      "top_plugins",
      "top_techdocs",
      "top_searches",
    ];

    await Promise.all([
      ...types.map((type) =>
        this.waitUntilApiCallIsMade(
          page,
          `/api/adoption-insights/events?type=${type}`,
        ),
      ),
      this.waitUntilApiCallSucceeds(page),
    ]);
  }
}
