import { expect, type Page } from "@playwright/test";

/**
 * Packaged-app sidebar items are not consistently exposed with ARIA roles on
 * nested groups. These selectors match the legacy UIhelper behavior that cluster-free
 * specs were written against.
 */
async function isLegacySectionExpanded(page: Page, sectionLabel: string): Promise<boolean> {
  // Intentional divergence: packaged-app section toggles use aria-label, not role=button.
  const ariaButton = page.locator(`nav button[aria-label="${sectionLabel}"]`);
  if ((await ariaButton.count()) === 0) {
    return false;
  }

  // Only trust aria-expanded; parent xpath checks match unrelated sidebar links.
  return (await ariaButton.getAttribute("aria-expanded")) === "true";
}

function isLegacyChildLinkVisible(page: Page, childItemText: string): Promise<boolean> {
  // Intentional divergence: legacy sidebar links live in nav a, not role=navigation scope.
  const childLink = page.locator(`nav a:has-text("${childItemText}")`).first();
  return childLink.isVisible().catch(() => false);
}

export async function ensureLegacySectionExpanded(
  page: Page,
  sectionLabel: string,
  childItemText?: string,
): Promise<void> {
  if (childItemText !== undefined && (await isLegacyChildLinkVisible(page, childItemText))) {
    return;
  }
  if (childItemText === undefined && (await isLegacySectionExpanded(page, sectionLabel))) {
    return;
  }

  // Intentional divergence: packaged-app section toggles use aria-label, not role=button.
  const ariaButton = page.locator(`nav button[aria-label="${sectionLabel}"]`);
  if ((await ariaButton.count()) > 0) {
    await expect(ariaButton).toBeVisible();
    const expanded = await ariaButton.getAttribute("aria-expanded");
    if (expanded !== "true") {
      await ariaButton.click();
      if (expanded === "false") {
        await expect(ariaButton).toHaveAttribute("aria-expanded", "true");
      }
    }
    return;
  }

  // Intentional divergence: cluster-free sidebar root is login-button, not global-header nav.
  const sectionToggle = page.getByTestId("login-button").getByText(sectionLabel);
  if ((await sectionToggle.count()) > 0) {
    if (childItemText !== undefined && (await isLegacyChildLinkVisible(page, childItemText))) {
      return;
    }
    await expect(sectionToggle.first()).toBeVisible();
    await sectionToggle.first().click();
  }
}

export async function expandLegacySection(
  page: Page,
  sectionLabel: string,
  childItemText?: string,
): Promise<void> {
  await ensureLegacySectionExpanded(page, sectionLabel, childItemText);
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
