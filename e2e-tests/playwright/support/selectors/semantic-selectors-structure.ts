import { Locator, Page } from "@playwright/test";

export const semanticSelectorsStructure = {
  dialog(page: Page, name?: string | RegExp): Locator {
    return name === undefined
      ? page.getByRole("dialog")
      : page.getByRole("dialog", { name });
  },

  navigation(page: Page, name?: string | RegExp): Locator {
    return name === undefined
      ? page.getByRole("navigation")
      : page.getByRole("navigation", { name });
  },

  banner(page: Page): Locator {
    return page.getByRole("banner");
  },

  main(page: Page): Locator {
    return page.getByRole("main");
  },

  tab(page: Page, name: string | RegExp): Locator {
    return page.getByRole("tab", { name });
  },

  menuItem(page: Page, name: string | RegExp): Locator {
    return page.getByRole("menuitem", { name });
  },

  list(page: Page, name?: string | RegExp): Locator {
    return name === undefined
      ? page.getByRole("list")
      : page.getByRole("list", { name });
  },

  listItem(page: Page, text?: string | RegExp): Locator {
    const items = page.getByRole("listitem");
    return text === undefined ? items : items.filter({ hasText: text });
  },

  article(page: Page): Locator {
    return page.getByRole("article");
  },

  region(page: Page, name?: string | RegExp): Locator {
    return name === undefined
      ? page.getByRole("region")
      : page.getByRole("region", { name });
  },

  alert(page: Page, name?: string | RegExp): Locator {
    return name === undefined
      ? page.getByRole("alert")
      : page.getByRole("alert", { name });
  },

  testId(page: Page, testId: string): Locator {
    return page.getByTestId(testId);
  },

  image(page: Page, altText: string | RegExp): Locator {
    return page.getByAltText(altText);
  },

  title(page: Page, title: string | RegExp): Locator {
    return page.getByTitle(title);
  },

  scopedByRole(
    container: Locator,
    role:
      | "button"
      | "link"
      | "heading"
      | "textbox"
      | "cell"
      | "row"
      | "columnheader"
      | "tab"
      | "menuitem"
      | "listitem",
    name?: string | RegExp,
  ): Locator {
    return name === undefined
      ? container.getByRole(role)
      : container.getByRole(role, { name });
  },
};
