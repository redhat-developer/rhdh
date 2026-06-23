import { expect, Page } from "@playwright/test";
import { getCardByHeading } from "../../support/page-objects/ui-locators";
import { getCurrentLanguage } from "../../e2e/localization/locale";
import {
  clickButtonByLabel,
  clickByDataTestId,
  clickLink,
} from "./interaction";
import { openSidebar, selectMuiBox } from "./navigation";
import {
  verifyAlertErrorMessage,
  verifyHeading,
  verifyRowsInTable,
} from "./verification";
import { verifyCellsInTable } from "./table";

export async function verifyLinkinCard(
  page: Page,
  cardHeading: string,
  linkText: string,
  exact = true,
) {
  const link = getCardByHeading(page, cardHeading)
    .getByRole("link")
    .getByText(linkText, { exact })
    .first();
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeVisible();
}

export async function verifyTextinCard(
  page: Page,
  cardHeading: string,
  text: string | RegExp,
  exact = true,
) {
  const locator = getCardByHeading(page, cardHeading)
    .getByText(text, { exact })
    .first();
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
}

export async function waitForCardWithHeader(page: Page, cardHeading: string) {
  await getCardByHeading(page, cardHeading).waitFor({
    state: "visible",
  });
}

export function toRgb(color: string): string {
  if (color.startsWith("rgb")) {
    return color;
  }

  const bigint = parseInt(color.slice(1), 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgb(${r}, ${g}, ${b})`;
}

export async function checkCssColor(
  page: Page,
  selector: string,
  expectedColor: string,
) {
  const elements = page.locator(selector);
  const count = await elements.count();
  const expectedRgbColor = toRgb(expectedColor);

  for (let i = 0; i < count; i++) {
    const color = await elements
      .nth(i)
      .evaluate((el) => window.getComputedStyle(el).color);
    expect(color).toBe(expectedRgbColor);
  }
}

const lang = getCurrentLanguage();

const quickstartHideLabel = {
  en: "Hide",
  de: "Ausblenden",
  es: "Ocultar",
  fr: "Cacher",
  it: "Nascondi",
  ja: "非表示",
} as const;

function getQuickstartHideButton(page: Page) {
  const label = quickstartHideLabel[lang] ?? quickstartHideLabel.en;
  return page.getByRole("button", { name: label });
}

export async function hideQuickstartIfVisible(page: Page): Promise<void> {
  const quickstartHideButton = getQuickstartHideButton(page);
  if (await quickstartHideButton.isVisible()) {
    await quickstartHideButton.click();
    await quickstartHideButton.waitFor({ state: "hidden", timeout: 5000 });
  }
}

export async function openQuickstartIfHidden(page: Page): Promise<void> {
  const quickstartHideButton = page.getByRole("button", {
    name: "Hide",
  });

  const progressBars = page.getByTestId("progress");
  await expect(progressBars).toHaveCount(0);

  if (!(await quickstartHideButton.isVisible())) {
    await clickButtonByLabel(page, "Help");
    await clickByDataTestId(page, "quickstart-button");
  }
  await expect(quickstartHideButton).toBeVisible();
}

export async function verifyLocationRefreshButtonIsEnabled(
  page: Page,
  locationName: string,
) {
  await expect(async () => {
    await page.goto("/");
    await openSidebar(page, "Catalog");
    await selectMuiBox(page, "Kind", "Location");
    await verifyHeading(page, "All locations");
    await verifyCellsInTable(page, [locationName]);
    await clickLink(page, locationName);
    await verifyHeading(page, locationName);
  }).toPass({
    intervals: [1_000, 2_000, 5_000],
    timeout: 20 * 1000,
  });

  const refreshButton = page.getByRole("button", {
    name: "Schedule entity refresh",
  });
  await expect(refreshButton).toHaveCount(1);

  await refreshButton.click();
  await verifyAlertErrorMessage(page, "Refresh scheduled");

  const moreButton = page.getByRole("button", { name: "more" }).first();
  await moreButton.waitFor({ state: "visible", timeout: 4000 });
  await moreButton.waitFor({ state: "attached", timeout: 4000 });
  await moreButton.click();

  const unregisterItem = page
    .getByRole("menuitem")
    .filter({ hasText: "Unregister entity" })
    .first();
  await unregisterItem.waitFor({ state: "visible", timeout: 4000 });
  await unregisterItem.waitFor({ state: "attached", timeout: 4000 });
  await expect(unregisterItem).toBeEnabled();
}

export async function clickUnregisterButtonForDisplayedEntity(
  page: Page,
  buttonName: "Delete Entity" | "Unregister Location" = "Delete Entity",
) {
  const moreButton = page.getByRole("button", { name: "more" }).first();
  await moreButton.waitFor({ state: "visible" });
  await moreButton.waitFor({ state: "attached" });
  await moreButton.click();

  const unregisterItem = page
    .getByRole("menuitem")
    .filter({ hasText: "Unregister entity" })
    .first();
  await unregisterItem.waitFor({ state: "visible" });
  await unregisterItem.click();

  const deleteButton = page.getByRole("button", {
    name: buttonName,
  });
  await deleteButton.waitFor({ state: "visible" });
  await deleteButton.waitFor({ state: "attached" });
  await deleteButton.click();
}

export async function verifyComponentInCatalog(
  page: Page,
  kind: string,
  expectedRows: string[],
) {
  await openSidebar(page, "Catalog");
  await selectMuiBox(page, "Kind", kind);
  await verifyRowsInTable(page, expectedRows);
}
