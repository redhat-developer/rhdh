import { expect, Page } from "@playwright/test";

import { getTranslations, getCurrentLanguage } from "../../e2e/localization/locale";
import { hasJsonHealthcheck } from "../../support/auth/app-shell";
import {
  expandLegacySection,
  openLegacyLink,
  waitForLegacySidebarVisible,
} from "../../support/navigation/legacy-sidebar-adapter";
import {
  expandRhdhSection,
  openRhdhLink,
  waitForRhdhSidebarVisible,
} from "../../support/navigation/rhdh-sidebar-adapter";
import { SEARCH_OBJECTS_COMPONENTS } from "../../support/selectors/page-selectors";
import { clickByDataTestId, clickLink, getGlobalHeader } from "./interaction";
import * as table from "./table";
import { verifyHeading } from "./verification";

const t = getTranslations();
const lang = getCurrentLanguage();

let cachedUsesRhdhSidebar: boolean | undefined;
let cachedSidebarBaseUrl: string | undefined;

async function hasLegacySidebarMarkup(page: Page): Promise<boolean> {
  // Intentional divergence: packaged-app exposes login-button; cluster RHDH uses global-header nav.
  const packagedSidebar = page.getByTestId("login-button");
  if ((await packagedSidebar.count()) > 0) {
    return packagedSidebar.isVisible().catch(() => false);
  }

  const legacyNavButton = page.getByRole("navigation").getByRole("button").first();
  return legacyNavButton.isVisible().catch(() => false);
}

async function detectRhdhSidebar(page: Page): Promise<boolean> {
  // Intentional divergence: cluster-free harness forces legacy adapter (playwright.legacy-local.config.ts).
  if (process.env.E2E_FORCE_LEGACY_SIDEBAR === "true") {
    return false;
  }
  // Cluster-free legacy harness proxies JSON /healthcheck but keeps legacy nav markup.
  if (await hasLegacySidebarMarkup(page)) {
    return false;
  }
  return hasJsonHealthcheck(page);
}

async function usesRhdhSidebar(page: Page): Promise<boolean> {
  const baseUrl = process.env.BASE_URL ?? page.url();
  if (cachedSidebarBaseUrl !== baseUrl || cachedUsesRhdhSidebar === undefined) {
    cachedUsesRhdhSidebar = await detectRhdhSidebar(page);
    cachedSidebarBaseUrl = baseUrl;
  }
  return cachedUsesRhdhSidebar;
}

async function runSidebarAction(
  page: Page,
  legacy: (page: Page) => Promise<void>,
  rhdh: (page: Page) => Promise<void>,
): Promise<void> {
  // Intentional divergence: dual sidebar adapters — legacy packaged-app vs RHDH global-header.
  if (await usesRhdhSidebar(page)) {
    await rhdh(page);
    return;
  }
  await legacy(page);
}

async function openLegacySidebarLink(page: Page, navBarText: string): Promise<void> {
  await openLegacyLink(page, navBarText);
}

async function openRhdhSidebarLink(page: Page, navBarText: string): Promise<void> {
  await openRhdhLink(page, navBarText);
}

async function expandLegacySidebarSection(page: Page, navBarButtonLabel: string): Promise<void> {
  await expandLegacySection(page, navBarButtonLabel);
}

async function expandRhdhSidebarSection(page: Page, navBarButtonLabel: string): Promise<void> {
  await expandRhdhSection(page, navBarButtonLabel);
}

async function openProfileDropdown(page: Page) {
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
  await runSidebarAction(page, waitForLegacySidebarVisible, waitForRhdhSidebarVisible);
}

export async function openSidebar(page: Page, navBarText: string) {
  await runSidebarAction(
    page,
    (currentPage) => openLegacySidebarLink(currentPage, navBarText),
    (currentPage) => openRhdhSidebarLink(currentPage, navBarText),
  );
}

export async function openTemplateInCatalog(
  page: Page,
  templateName: string,
  kindColumn: string = templateName,
): Promise<void> {
  await openSidebar(page, "Catalog");
  await selectMuiBox(page, "Kind", "Template");
  await page.fill(SEARCH_OBJECTS_COMPONENTS.placeholderSearch, `${templateName}\n`);
  await table.verifyRowInTableByUniqueText(page, templateName, [kindColumn]);
  await clickLink(page, templateName);
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
  await runSidebarAction(
    page,
    (currentPage) => expandLegacySidebarSection(currentPage, navBarButtonLabel),
    (currentPage) => expandRhdhSidebarSection(currentPage, navBarButtonLabel),
  );
}

export async function selectMuiBox(page: Page, label: string, value: string, notVisible?: boolean) {
  // Wait for any overlaying dialogs to close before interacting
  await page
    .getByRole("dialog")
    .waitFor({ state: "detached", timeout: 3000 })
    .catch(() => {});

  const combobox = page
    .getByRole("combobox", { name: label })
    // Intentional divergence: MUI Autocomplete exposes aria-label div, not always role=combobox.
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
