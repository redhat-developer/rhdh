import { expect, type Page } from "@playwright/test";

/**
 * Packaged-app sidebar items are not consistently exposed with ARIA roles on
 * nested groups. These selectors match the legacy UIhelper behavior that cluster-free
 * specs were written against.
 */
async function isLegacySectionExpanded(page: Page, sectionLabel: string): Promise<boolean> {
  const ariaButton = page.locator(`nav button[aria-label="${sectionLabel}"]`);
  if ((await ariaButton.count()) === 0) {
    return false;
  }

  const expanded = await ariaButton.getAttribute("aria-expanded");
  if (expanded === "true") {
    return true;
  }
  if (expanded === "false") {
    return false;
  }

  const sectionGroup = ariaButton.locator("xpath=..");
  const nestedLinks = sectionGroup.getByRole("link");
  return (await nestedLinks.count()) > 0 && (await nestedLinks.first().isVisible());
}

export async function ensureLegacySectionExpanded(
  page: Page,
  sectionLabel: string,
  childItemText?: string,
): Promise<void> {
  if (childItemText !== undefined) {
    const childLink = page.locator(`nav a:has-text("${childItemText}")`).first();
    if (await childLink.isVisible().catch(() => false)) {
      return;
    }
  } else if (await isLegacySectionExpanded(page, sectionLabel)) {
    return;
  }

  // Intentional divergence: packaged-app section toggles use aria-label, not role=button.
  const ariaButton = page.locator(`nav button[aria-label="${sectionLabel}"]`);
  if ((await ariaButton.count()) > 0) {
    await expect(ariaButton).toBeVisible();
    await ariaButton.click();
    return;
  }

  // Intentional divergence: cluster-free sidebar root is login-button, not global-header nav.
  const sectionToggle = page.getByTestId("login-button").getByText(sectionLabel);
  await expect(sectionToggle.first()).toBeVisible();
  await sectionToggle.first().click();
}

export async function expandLegacySection(page: Page, sectionLabel: string): Promise<void> {
  await ensureLegacySectionExpanded(page, sectionLabel);
}

export async function openLegacyLink(page: Page, linkName: string): Promise<void> {
  // Intentional divergence: getByRole('navigation') matches global-header; sidebar links live in nav a.
  const link = page.locator(`nav a:has-text("${linkName}")`).first();
  await expect(link).toBeVisible({ timeout: 15_000 });
  await link.click();
}

export async function waitForLegacySidebarVisible(page: Page): Promise<void> {
  // Intentional divergence: legacy sidebar links have no stable role=navigation scope.
  await expect(page.locator("nav a").first()).toBeVisible({ timeout: 10_000 });
}
