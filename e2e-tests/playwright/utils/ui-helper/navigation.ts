import { expect, Page } from "@playwright/test";

import { getTranslations, getCurrentLanguage } from "../../e2e/localization/locale";
import { getErrorMessage } from "../errors";
import { clickButtonByText, clickByDataTestId, clickLink, getGlobalHeader } from "./interaction";
import { verifyHeading } from "./verification";

const t = getTranslations();
const lang = getCurrentLanguage();

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
  await expect(page.getByRole("navigation").getByRole("link").first()).toBeVisible({
    timeout: 10_000,
  });
}

export async function openSidebar(page: Page, navBarText: string) {
  const navLink = page.locator("nav").getByRole("link", { name: navBarText });
  await expect(navLink).toBeVisible({ timeout: 15_000 });
  await navLink.scrollIntoViewIfNeeded();
  // oxlint-disable-next-line playwright/no-force-option -- nested links sit under expandable section headers that intercept clicks in CI
  await navLink.click({ force: true, timeout: 15_000 });
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
  const navLink = page.locator(`nav button[aria-label="${navBarButtonLabel}"]`);
  await navLink.waitFor({ state: "visible" });

  const expanded = await navLink.getAttribute("aria-expanded");
  if (expanded !== "true") {
    await navLink.click();
  }
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
