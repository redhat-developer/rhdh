import { Page, Locator } from "@playwright/test";

export const semanticSelectorsAccessibility = {
  button(page: Page, name: string | RegExp): Locator {
    return page.getByRole("button", { name });
  },

  link(page: Page, name: string | RegExp): Locator {
    return page.getByRole("link", { name });
  },

  table(page: Page): Locator {
    return page.getByRole("table");
  },

  tableCell(page: Page, text?: string | RegExp): Locator {
    if (text === undefined) {
      return page.getByRole("cell");
    }
    return page.getByRole("cell", { name: text });
  },

  tableHeader(page: Page, name: string | RegExp): Locator {
    return page.getByRole("columnheader", { name });
  },

  tableRow(page: Page, text?: string | RegExp): Locator {
    const rows = page.getByRole("row");
    if (text === undefined) {
      return rows;
    }
    return rows.filter({ hasText: text });
  },

  heading(
    page: Page,
    name: string | RegExp,
    level?: 1 | 2 | 3 | 4 | 5 | 6,
  ): Locator {
    return page.getByRole("heading", { name, level });
  },

  inputByLabel(page: Page, label: string | RegExp): Locator {
    return page.getByLabel(label);
  },

  inputByPlaceholder(page: Page, placeholder: string | RegExp): Locator {
    return page.getByPlaceholder(placeholder);
  },

  checkbox(page: Page, label: string | RegExp): Locator {
    return page.getByRole("checkbox", { name: label });
  },

  radio(page: Page, label: string | RegExp): Locator {
    return page.getByRole("radio", { name: label });
  },
};
