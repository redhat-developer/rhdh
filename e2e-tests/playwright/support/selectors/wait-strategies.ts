import { Page } from "@playwright/test";

export const WaitStrategies = {
  async forDOMContentLoaded(page: Page): Promise<void> {
    await page.waitForLoadState("domcontentloaded");
  },

  async forAPIResponse(
    page: Page,
    urlPattern: string | RegExp,
    statusCode: number = 200,
  ): Promise<void> {
    await page.waitForResponse((response) => {
      const url = response.url();
      const matchesUrl =
        typeof urlPattern === "string"
          ? url.includes(urlPattern)
          : urlPattern.test(url);
      return matchesUrl && response.status() === statusCode;
    });
  },
};
