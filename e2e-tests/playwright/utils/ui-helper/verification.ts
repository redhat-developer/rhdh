import { expect, Locator, Page } from "@playwright/test";

import { getErrorMessage } from "../errors";
import { DEFAULT_VERIFY_LINK_OPTIONS } from "./defaults";

export async function verifyDivHasText(page: Page, divText: string | RegExp) {
  await expect(page.getByText(divText)).toBeVisible();
}

export async function verifyLink(
  page: Page,
  arg: string | { label: string },
  options?: {
    exact?: boolean;
    notVisible?: boolean;
  },
) {
  const { exact, notVisible } = { ...DEFAULT_VERIFY_LINK_OPTIONS, ...options };
  let linkLocator: Locator;
  let notVisibleCheck: boolean;

  if (typeof arg === "object") {
    linkLocator = page.locator(`div[aria-label="${arg.label}"] a`);
    notVisibleCheck = false;
  } else {
    linkLocator = page.getByRole("link", { name: arg, exact }).first();
    notVisibleCheck = notVisible;
  }

  if (notVisibleCheck) {
    await expect(linkLocator).toBeHidden();
  } else {
    await expect(linkLocator).toBeVisible();
  }
}

export async function verifyTextVisible(
  page: Page,
  text: string,
  exact = false,
  timeout = 10000,
): Promise<void> {
  const locator = page.getByText(text, { exact });
  await expect(locator).toBeVisible({ timeout });
}

export async function verifyText(
  page: Page,
  text: string | RegExp,
  exact: boolean = true,
  timeout: number = 5000,
) {
  await verifyTextInLocator(page, "", text, exact, timeout);
}

export async function verifyRowsInTable(
  page: Page,
  rowTexts: (string | RegExp)[],
  exact: boolean = true,
) {
  for (const rowText of rowTexts) {
    await verifyTextInLocator(page, `tr>td`, rowText, exact);
  }
}

export async function waitForTextDisappear(page: Page, text: string) {
  await expect(page.getByText(text)).toHaveCount(0);
}

async function verifyTextInLocator(
  page: Page,
  locator: string,
  text: string | RegExp,
  exact: boolean,
  timeout: number = 5000,
) {
  const elementLocator = locator
    ? page.locator(locator).getByText(text, { exact }).first()
    : page.getByText(text, { exact }).first();

  await elementLocator.waitFor({ state: "visible", timeout });
  await elementLocator.waitFor({ state: "attached" });

  try {
    await elementLocator.scrollIntoViewIfNeeded();
  } catch (error) {
    console.warn(`Warning: Could not scroll element into view. Error: ${getErrorMessage(error)}`);
  }
  await expect(elementLocator).toBeVisible();
}

export async function verifyTextInSelector(page: Page, selector: string, expectedText: string) {
  const elementLocator = page.locator(selector).getByText(expectedText, { exact: true });

  try {
    await elementLocator.waitFor({ state: "visible" });
    const actualText = (await elementLocator.textContent()) ?? "No content";

    if (actualText.trim() !== expectedText.trim()) {
      console.error(
        `Verification failed for text: Expected "${expectedText}", but got "${actualText}"`,
      );
      throw new Error(
        `Expected text "${expectedText}" not found. Actual content: "${actualText}".`,
      );
    }
    console.log(`Text "${expectedText}" verified successfully in selector: ${selector}`);
  } catch (error) {
    const allTextContent = await page.locator(selector).allTextContents();
    console.error(
      `Verification failed for text: Expected "${expectedText}". Selector content: ${allTextContent.join(", ")}`,
    );
    throw error;
  }
}

export async function verifyPartialTextInSelector(
  page: Page,
  selector: string,
  partialText: string,
) {
  try {
    const elements = page.locator(selector);
    const count = await elements.count();

    for (let i = 0; i < count; i++) {
      const textContent = await elements.nth(i).textContent();
      if (textContent !== null && textContent.includes(partialText)) {
        console.log(`Found partial text: ${partialText} in element: ${textContent}`);
        return;
      }
    }

    throw new Error(
      `Verification failed: Partial text "${partialText}" not found in any elements matching selector "${selector}".`,
    );
  } catch (error) {
    console.error(getErrorMessage(error));
    throw error;
  }
}

export async function verifyColumnHeading(
  page: Page,
  rowTexts: string[] | RegExp[],
  exact: boolean = true,
) {
  for (const rowText of rowTexts) {
    const rowLocator = page.getByRole("columnheader").getByText(rowText, { exact }).first();
    await rowLocator.waitFor({ state: "visible" });
    await rowLocator.scrollIntoViewIfNeeded();
    await expect(rowLocator).toBeVisible();
  }
}

export async function verifyHeading(page: Page, heading: string | RegExp, timeout: number = 20000) {
  const headingLocator = page.getByRole("heading").filter({ hasText: heading }).first();

  await headingLocator.waitFor({ state: "visible", timeout });
  await expect(headingLocator).toBeVisible();
}

export async function waitForTitle(page: Page, text: string, level: number = 1) {
  await expect(page.locator(`h${level}:has-text("${text}")`)).toBeVisible();
}

export async function verifyAlertErrorMessage(page: Page, message: string | RegExp) {
  const alert = page.getByRole("alert");
  await alert.waitFor();
  await expect(alert).toHaveText(message);
}
