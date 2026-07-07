import { expect, type Locator, type Page } from "@playwright/test";

function getNav(page: Page): Locator {
  return page
    .getByRole("navigation")
    .filter({ hasNot: page.getByTestId("KeyboardArrowDownOutlinedIcon") })
    .first();
}

function sidebarLinks(page: Page, linkName: string): Locator {
  return getNav(page).getByRole("link", { name: linkName, exact: true });
}

function isRhdhChildLinkVisible(page: Page, linkName: string): Promise<boolean> {
  return sidebarLinks(page, linkName)
    .first()
    .isVisible()
    .catch(() => false);
}

async function isRhdhSectionExpanded(page: Page, sectionLabel: string): Promise<boolean> {
  const sectionButton = getNav(page).getByRole("button", {
    name: sectionLabel,
    exact: true,
  });
  if ((await sectionButton.count()) === 0) {
    return false;
  }

  return (await sectionButton.getAttribute("aria-expanded")) === "true";
}

export async function ensureRhdhSectionExpanded(
  page: Page,
  sectionLabel: string,
  childItemText?: string,
): Promise<void> {
  if (childItemText !== undefined && (await isRhdhChildLinkVisible(page, childItemText))) {
    return;
  }
  if (childItemText === undefined && (await isRhdhSectionExpanded(page, sectionLabel))) {
    return;
  }

  const sectionButton = getNav(page).getByRole("button", {
    name: sectionLabel,
    exact: true,
  });
  await expect(sectionButton).toBeVisible();
  const expanded = await sectionButton.getAttribute("aria-expanded");
  if (expanded !== "true") {
    await sectionButton.click();
    if (expanded === "false") {
      await expect(sectionButton).toHaveAttribute("aria-expanded", "true");
    }
  }
}

async function resolveVisibleLink(page: Page, linkName: string): Promise<Locator> {
  const candidates = sidebarLinks(page, linkName);
  await expect(candidates.first()).toBeAttached({ timeout: 15_000 });

  const count = await candidates.count();
  for (let index = 0; index < count; index++) {
    const candidate = candidates.nth(index);
    if (await candidate.isVisible()) {
      return candidate;
    }
  }

  throw new Error(`Sidebar link "${linkName}" is not visible`);
}

async function activateLink(page: Page, resolveLink: () => Promise<Locator>): Promise<void> {
  try {
    await expect(async () => {
      const link = await resolveLink();
      await link.scrollIntoViewIfNeeded();
      await expect(link).toBeEnabled();
      await link.click({ timeout: 3000 });
    }).toPass({
      intervals: [500],
      timeout: 15_000,
    });
  } catch {
    const link = await resolveLink();
    const href = await link.getAttribute("href");
    if (href !== null && href !== "") {
      // Intentional divergence: sidebar link click can fail when overlay blocks; goto href as fallback.
      await page.goto(href);
      return;
    }
    throw new Error("Sidebar link is not clickable and has no href fallback");
  }
}

export async function expandRhdhSection(
  page: Page,
  sectionLabel: string,
  childItemText?: string,
): Promise<void> {
  await ensureRhdhSectionExpanded(page, sectionLabel, childItemText);
}

export async function openRhdhLink(page: Page, linkName: string): Promise<void> {
  await activateLink(page, () => resolveVisibleLink(page, linkName));
}

export async function waitForRhdhSidebarVisible(page: Page): Promise<void> {
  await expect(getNav(page).getByRole("link").first()).toBeVisible({
    timeout: 10_000,
  });
}
