import { expect, Locator, Page } from "@playwright/test";

import { getTranslations, getCurrentLanguage } from "../../e2e/localization/locale";
import { getErrorMessage } from "../errors";
import { clickButtonByText, clickByDataTestId, clickLink, getGlobalHeader } from "./interaction";
import { verifyHeading } from "./verification";

const t = getTranslations();
const lang = getCurrentLanguage();

/** Left nav excluding the global header bar (profile menu uses a separate navigation). */
export function getSidebarNav(page: Page): Locator {
  return page
    .getByRole("navigation")
    .filter({ hasNot: page.getByTestId("KeyboardArrowDownOutlinedIcon") })
    .first();
}

function sidebarLinks(page: Page, linkName: string): Locator {
  return getSidebarNav(page).getByRole("link", { name: linkName, exact: true });
}

async function resolveVisibleSidebarLink(page: Page, linkName: string): Promise<Locator> {
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

async function expandSidebarSection(page: Page, sectionLabel: string): Promise<void> {
  const sectionButton = getSidebarNav(page).getByRole("button", {
    name: sectionLabel,
    exact: true,
  });
  await expect(sectionButton).toBeVisible();

  const expanded = await sectionButton.getAttribute("aria-expanded");
  if (expanded === "true") {
    return;
  }
  if (expanded === "false") {
    await sectionButton.click();
    await expect(sectionButton).toHaveAttribute("aria-expanded", "true");
    return;
  }

  // Some sidebar sections omit aria-expanded; avoid toggling closed an already-open group.
  const sectionGroup = sectionButton.locator("xpath=..");
  const nestedLinks = sectionGroup.getByRole("link");
  if ((await nestedLinks.count()) > 0 && (await nestedLinks.first().isVisible())) {
    return;
  }
  await sectionButton.click();
}

/** Collapse expanded sidebar sections so nested links are not covered by layout overlays. */
async function collapseOtherExpandedSidebarSections(
  page: Page,
  keepSection: string,
): Promise<void> {
  const nav = getSidebarNav(page);
  const keepButton = nav.getByRole("button", { name: keepSection, exact: true });
  const keepHandle = await keepButton.elementHandle();
  const buttons = nav.getByRole("button");
  const count = await buttons.count();
  for (let index = 0; index < count; index++) {
    const button = buttons.nth(index);
    if ((await button.getAttribute("aria-expanded")) !== "true") {
      continue;
    }
    if (keepHandle !== null && (await button.evaluate((el, keep) => el === keep, keepHandle))) {
      continue;
    }
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "false");
  }
}

async function resolveVisibleSidebarLinkInSection(
  page: Page,
  sectionLabel: string,
  linkName: string,
): Promise<Locator> {
  const sectionButton = getSidebarNav(page).getByRole("button", {
    name: sectionLabel,
    exact: true,
  });
  await expect(sectionButton).toBeVisible();

  const sectionGroup = sectionButton.locator("xpath=..");
  const scopedLink = sectionGroup.getByRole("link", { name: linkName, exact: true });
  if ((await scopedLink.count()) > 0 && (await scopedLink.first().isVisible())) {
    return scopedLink.first();
  }

  return resolveVisibleSidebarLink(page, linkName);
}

async function activateSidebarLink(page: Page, resolveLink: () => Promise<Locator>): Promise<void> {
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
    // RHDH sidebar MUI layout can intercept pointer events on nested links in CI.
    if (href !== null && href !== "") {
      await page.goto(href);
      return;
    }
    throw new Error("Sidebar link is not clickable and has no href fallback");
  }
}

async function clickSidebarLink(page: Page, linkName: string): Promise<void> {
  await activateSidebarLink(page, () => resolveVisibleSidebarLink(page, linkName));
}

async function clickSidebarLinkInSection(
  page: Page,
  sectionLabel: string,
  linkName: string,
): Promise<void> {
  await activateSidebarLink(page, () =>
    resolveVisibleSidebarLinkInSection(page, sectionLabel, linkName),
  );
}

export async function expectSidebarLinkVisible(
  page: Page,
  linkName: string,
  sectionName?: string,
): Promise<void> {
  if (sectionName !== undefined && sectionName !== "") {
    await expandSidebarSection(page, sectionName);
  }
  const link = await resolveVisibleSidebarLink(page, linkName);
  await expect(link).toBeVisible();
}

export async function openProfileDropdown(page: Page) {
  const header = getGlobalHeader(page);
  await expect(header).toBeVisible();
  await header.getByTestId("KeyboardArrowDownOutlinedIcon").click();
}

export async function goToPageUrl(page: Page, url: string, heading?: string) {
  await page.goto(url);
  await expect(page).toHaveURL(url);
  if (heading !== undefined && heading !== "") {
    await verifyHeading(page, heading);
  }
}

export async function goToMyProfilePage(page: Page) {
  await expect(getGlobalHeader(page)).toBeVisible();
  await openProfileDropdown(page);
  // RHDHBUGS-2552: profile label not translated yet; keep English until fixed
  await clickLink(page, "My profile");
}

export async function goToSettingsPage(page: Page) {
  await expect(getGlobalHeader(page)).toBeVisible();
  await openProfileDropdown(page);
  const settingsItem = page.getByRole("menuitem", {
    name: t["plugin.global-header"][lang]["profile.settings"],
  });
  await expect(settingsItem).toBeVisible();
  await settingsItem.click();
}

export async function goToSelfServicePage(page: Page) {
  await clickLink(page, {
    ariaLabel: t["rhdh"][lang]["menuItem.selfService"],
  });
  await verifyHeading(page, t["scaffolder"][lang]["templateListPage.title"]);
}

export async function waitForSideBarVisible(page: Page) {
  await expect(getSidebarNav(page).getByRole("link").first()).toBeVisible({
    timeout: 10_000,
  });
}

export async function openSidebar(page: Page, navBarText: string) {
  await clickSidebarLink(page, navBarText);
}

export async function openSidebarLinkInSection(
  page: Page,
  sectionName: string,
  linkName: string,
): Promise<void> {
  await collapseOtherExpandedSidebarSections(page, sectionName);
  await expandSidebarSection(page, sectionName);
  await clickSidebarLinkInSection(page, sectionName, linkName);
}

export async function openCatalogSidebar(page: Page, kind: string) {
  await openSidebar(page, t["rhdh"][lang]["menuItem.catalog"]);
  await selectMuiBox(page, t["catalog-react"][lang]["entityKindPicker.title"], kind);
  await expect(async () => {
    await clickByDataTestId(page, "user-picker-all");
    await verifyHeading(page, new RegExp(`all ${kind}`, "iu"));
  }).toPass({
    intervals: [3_000],
    timeout: 20_000,
  });
}

export async function openSidebarButton(page: Page, navBarButtonLabel: string) {
  await expandSidebarSection(page, navBarButtonLabel);
}

export async function selectMuiBox(page: Page, label: string, value: string, notVisible?: boolean) {
  // Wait for any overlaying dialogs to close before interacting
  await page
    .getByRole("dialog")
    .waitFor({ state: "detached", timeout: 3000 })
    .catch(() => {});

  const combobox = page
    .getByRole("combobox", { name: label })
    .or(page.locator(`div[aria-label="${label}"]`))
    .first();

  await expect(combobox).toBeVisible();
  await combobox.click();

  const option = page.getByRole("option", { name: value });

  if (notVisible === true) {
    await expect(option).toBeHidden();
  } else {
    await expect(option).toBeVisible();
    await option.click();
  }
}

export async function markAllNotificationsAsReadIfVisible(page: Page) {
  try {
    const markAllReadDiv = page.getByTitle("Mark all read");
    const isVisible = await markAllReadDiv.isVisible();

    if (isVisible) {
      await markAllReadDiv.click();
      await clickButtonByText(page, "Mark All", {
        timeout: 5000,
      });
    }
  } catch (error) {
    console.log(
      "Mark all read functionality not available or already processed: ",
      getErrorMessage(error),
    );
  }
}
