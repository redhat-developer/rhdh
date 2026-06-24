import { expect, Locator, Page } from "@playwright/test";

import { getTableCell, getTableRow } from "../../support/page-objects/ui-locators";
import { DEFAULT_VERIFY_BUTTON_URL_OPTIONS } from "./defaults";

export async function verifyCellsInTable(page: Page, texts: (string | RegExp)[]) {
  for (const text of texts) {
    const cellLocator = getTableCell(page, text);
    const count = await cellLocator.count();

    if (count === 0) {
      throw new Error(
        `Expected at least one cell with text matching ${String(text)}, but none were found.`,
      );
    }

    for (let i = 0; i < count; i++) {
      await expect(cellLocator.nth(i)).toBeVisible();
    }
  }
}

export async function verifyButtonURL(
  page: Page,
  label: string | RegExp,
  url: string | RegExp,
  options?: { locator?: string | Locator; exact?: boolean },
) {
  const { locator, exact } = {
    ...DEFAULT_VERIFY_BUTTON_URL_OPTIONS,
    ...options,
  };
  const baseLocator =
    locator === undefined || locator === ""
      ? page
      : typeof locator === "string"
        ? page.locator(locator)
        : locator;

  const buttonUrl = await baseLocator
    .getByRole("button", { name: label, exact })
    .first()
    .getAttribute("href");

  expect(buttonUrl).toContain(url);
}

export async function verifyRowInTableByUniqueText(
  page: Page,
  uniqueRowText: string,
  cellTexts: string[] | RegExp[],
) {
  const row = getTableRow(page, uniqueRowText);
  await row.waitFor();
  for (const cellText of cellTexts) {
    await expect(row.getByRole("cell").filter({ hasText: cellText }).first()).toBeVisible();
  }
}

export async function clickOnLinkInTableByUniqueText(
  page: Page,
  uniqueRowText: string,
  linkText: string | RegExp,
  exact: boolean = true,
) {
  const row = getTableRow(page, uniqueRowText);
  await row.waitFor();
  await row.getByRole("link").getByText(linkText, { exact }).first().click();
}

export async function clickOnButtonInTableByUniqueText(
  page: Page,
  uniqueRowText: string,
  textOrLabel: string | RegExp,
) {
  const row = getTableRow(page, uniqueRowText);
  await row.waitFor();
  await row
    .locator(
      `button:has-text("${String(textOrLabel)}"), button[aria-label="${String(textOrLabel)}"]`,
    )
    .first()
    .click();
}

export async function verifyTableHeadingAndRows(page: Page, texts: string[]) {
  await page.waitForSelector("table tbody tr", { state: "visible" });
  for (const column of texts) {
    const columnSelector = `table th:has-text("${column}")`;
    const columnCount = await page.locator(columnSelector).count();
    expect(columnCount).toBeGreaterThan(0);
  }

  const rowSelector = `table tbody tr:not(:has(td[colspan]))`;
  const rowCount = await page.locator(rowSelector).count();
  expect(rowCount).toBeGreaterThan(0);
}

export async function verifyTableIsEmpty(page: Page) {
  const rowSelector = `table tbody tr:not(:has(td[colspan]))`;
  const rowCount = await page.locator(rowSelector).count();
  expect(rowCount).toEqual(0);
}

export async function verifyPluginRow(
  page: Page,
  text: string,
  expectedEnabled: string,
  expectedPreinstalled: string,
) {
  const rowSelector = `tr:has(td:text-is("${text}"))`;
  const row = page.locator(rowSelector);

  // Index 2 for "Enabled"
  const enabledColumn = row.getByRole("cell").nth(2);
  // Index 3 for "Preinstalled"
  const preinstalledColumn = row.getByRole("cell").nth(3);

  await expect(enabledColumn).toHaveText(expectedEnabled);
  await expect(preinstalledColumn).toHaveText(expectedPreinstalled);
}

export async function waitForLoginBtnDisappear(page: Page) {
  await page.getByRole("button", { name: "Log in" }).waitFor({ state: "detached" });
}
