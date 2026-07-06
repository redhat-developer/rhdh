import { expect, Locator, Page } from "@playwright/test";

import { DEFAULT_CLICK_BUTTON_BY_TEXT_OPTIONS, DEFAULT_CLICK_BUTTON_OPTIONS } from "./defaults";

export function getGlobalHeader(page: Page): Locator {
  return page.getByRole("navigation").filter({
    has: page.getByTestId("KeyboardArrowDownOutlinedIcon"),
  });
}

export async function clickButton(
  page: Page,
  label: string | RegExp,
  options?: { exact?: boolean; force?: boolean },
) {
  const { exact, force } = { ...DEFAULT_CLICK_BUTTON_OPTIONS, ...options };
  const button = page.getByRole("button", { name: label, exact }).first();

  await expect(button).toBeVisible();

  if (force) {
    // oxlint-disable-next-line playwright/no-force-option -- MUI overlay blocks native click in CI
    await button.click({ force: true });
  } else {
    await button.click();
  }
  return button;
}

export async function clickByDataTestId(page: Page, dataTestId: string) {
  const element = page.getByTestId(dataTestId);
  await element.waitFor({ state: "visible" });
  await element.click();
}

export async function clickButtonByText(
  page: Page,
  buttonText: string | RegExp,
  options?: {
    exact?: boolean;
    timeout?: number;
    force?: boolean;
  },
) {
  const { exact, timeout, force } = {
    ...DEFAULT_CLICK_BUTTON_BY_TEXT_OPTIONS,
    ...options,
  };
  const buttonElement = page.getByRole("button").getByText(buttonText, { exact });

  await buttonElement.waitFor({
    state: "visible",
    timeout,
  });

  if (force) {
    // oxlint-disable-next-line playwright/no-force-option -- MUI overlay blocks native click in CI
    await buttonElement.click({ force: true });
  } else {
    await buttonElement.click();
  }
}

export async function fillTextInputByLabel(page: Page, label: string, text: string) {
  await page.getByLabel(label).fill(text);
}

export async function checkCheckbox(page: Page, text: string) {
  const locator = page.getByRole("checkbox", {
    name: text,
  });
  await locator.check();
}

export async function uncheckCheckbox(page: Page, text: string) {
  const locator = page.getByRole("checkbox", {
    name: text,
  });
  await locator.uncheck();
}

export async function pressTab(page: Page) {
  await page.keyboard.press("Tab");
}

export async function clickLink(
  page: Page,
  options: string | { href: string } | { ariaLabel: string },
) {
  let linkLocator: Locator;

  if (typeof options === "string") {
    linkLocator = page.getByRole("link", { name: options }).first();
  } else if ("href" in options) {
    linkLocator = page.locator(`a[href="${options.href}"]`).first();
  } else {
    linkLocator = page.locator(`div[aria-label='${options.ariaLabel}'] a`).first();
  }

  await linkLocator.waitFor({ state: "visible" });
  await linkLocator.click();
}

export async function clickTab(page: Page, tabName: string) {
  const tabLocator = page.getByRole("tab", { name: tabName });
  await tabLocator.waitFor({ state: "visible" });
  await tabLocator.click();
}
