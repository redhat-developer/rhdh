import { expect, Locator, Page } from "@playwright/test";
import { getCardByText } from "../../support/selectors/ui-locators";
import { getErrorMessage } from "../errors";
import {
  DEFAULT_CLICK_BUTTON_BY_TEXT_OPTIONS,
  DEFAULT_CLICK_BUTTON_OPTIONS,
} from "./defaults";

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

export async function clickBtnByTitleIfNotPressed(page: Page, title: string) {
  const button = page.locator(`button[title="${title}"]`);
  const isPressed = await button.getAttribute("aria-pressed");

  if (isPressed === "false") {
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible();
    await button.click();
  }
}

export async function clickByDataTestId(page: Page, dataTestId: string) {
  const element = page.getByTestId(dataTestId);
  await element.waitFor({ state: "visible" });
  await element.click();
}

export async function clickDivByTitle(page: Page, title: string) {
  const divElement = page.locator(`div[title="${title}"]`);
  await divElement.waitFor({ state: "visible" });
  await divElement.click();
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
  const buttonElement = page
    .getByRole("button")
    .getByText(buttonText, { exact });

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

export async function clickButtonByLabel(page: Page, label: string | RegExp) {
  await page.getByRole("button", { name: label }).first().click();
}

export async function fillTextInputByLabel(
  page: Page,
  label: string,
  text: string,
) {
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

export async function clickByTitleIfVisible(
  page: Page,
  title: string,
  elementType: string = "div",
): Promise<boolean> {
  try {
    const element = page.locator(`${elementType}[title="${title}"]`);
    const isVisible = await element.isVisible();

    if (isVisible) {
      await element.click();
      return true;
    }
    return false;
  } catch (error) {
    console.log(
      `Element with title "${title}" not found or not clickable: `,
      getErrorMessage(error),
    );
    return false;
  }
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
    linkLocator = page
      .locator(`div[aria-label='${options.ariaLabel}'] a`)
      .first();
  }

  await linkLocator.waitFor({ state: "visible" });
  await linkLocator.click();
}

export async function clickTab(page: Page, tabName: string) {
  const tabLocator = page.getByRole("tab", { name: tabName });
  await tabLocator.waitFor({ state: "visible" });
  await tabLocator.click();
}

export async function clickById(page: Page, id: string) {
  const locator = page.locator(`#${id}`);
  await locator.waitFor({ state: "attached" });
  await locator.click();
}

export async function clickBtnInCard(
  page: Page,
  cardText: string,
  btnText: string,
  exact = true,
) {
  const cardLocator = getCardByText(page, cardText).first();
  await cardLocator.scrollIntoViewIfNeeded();
  await cardLocator
    .getByRole("button", { name: btnText, exact })
    .first()
    .click();
}
