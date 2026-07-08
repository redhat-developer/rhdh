import { Page } from "@playwright/test";

async function isElementVisible(
  page: Page,
  locator: string,
  timeout = 10000,
  force = false,
): Promise<boolean> {
  try {
    const button = page.locator(locator).first();
    await button.waitFor({ state: "visible", timeout });
    return await button.isVisible();
  } catch (error) {
    if (force) throw error;
    return false;
  }
}

export function isTextVisible(page: Page, text: string, timeout = 10000): Promise<boolean> {
  // Intentional divergence: legacy helpers match visible text before role-based locators existed.
  const locator = `:has-text("${text}")`;
  return isElementVisible(page, locator, timeout);
}
