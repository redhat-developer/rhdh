import { expect, Page } from "@playwright/test";

import { getTableRow } from "../../support/selectors/ui-locators";

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

export async function waitForLoginBtnDisappear(page: Page) {
  await page.getByRole("button", { name: "Log in" }).waitFor({ state: "detached" });
}
