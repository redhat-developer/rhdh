import { expect, type Page } from "@playwright/test";

function legacyNavigation(page: Page) {
  return page.getByRole("navigation").first();
}

export async function expandLegacySection(page: Page, sectionLabel: string): Promise<void> {
  const navButton = legacyNavigation(page).getByRole("button", {
    name: sectionLabel,
    exact: true,
  });
  if ((await navButton.count()) > 0) {
    await expect(navButton.first()).toBeVisible();
    await navButton.first().click();
    return;
  }

  const sectionToggle = page.getByTestId("login-button").getByText(sectionLabel, { exact: true });
  await expect(sectionToggle.first()).toBeVisible();
  await sectionToggle.first().click();
}

export async function openLegacyLink(page: Page, linkName: string): Promise<void> {
  const link = legacyNavigation(page).getByRole("link", { name: linkName }).first();
  await expect(link).toBeVisible({ timeout: 15_000 });
  await link.click();
}

export async function waitForLegacySidebarVisible(page: Page): Promise<void> {
  await expect(legacyNavigation(page).getByRole("link").first()).toBeVisible({
    timeout: 10_000,
  });
}
