import { test, expect, type Locator, type Page } from "@support/coverage/test";

import { getRhdhSidebarNavigation } from "../support/navigation/rhdh-sidebar-adapter";
import { APP_TITLE, SIDEBAR_ITEM_SELECTED_BACKGROUND } from "../support/test-data/branding";

// Computed styles report colours as rgb(); the config uses hex.
function hexToRgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

// The colour actually painted behind an element: its own background, or that of
// the closest ancestor with a non-transparent one.
function paintedBackground(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor;
      if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
        return color;
      }
    }
    return getComputedStyle(document.body).backgroundColor;
  });
}

function sidebarLink(page: Page, name: string): Locator {
  return getRhdhSidebarNavigation(page).getByRole("link", { name, exact: true });
}

test.describe("Branding", () => {
  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
  });

  // RHDHBUGS-2040: the served HTML must carry app.title, so the tab shows it
  // while the app is still loading, not only after React takes over.
  test(
    "Serves the custom app title in the HTML before the app loads",
    { tag: "@cluster-free-capable" },
    async ({ request }) => {
      const response = await request.get("/");
      expect(response.status()).toBe(200);

      const html = await response.text();
      const title = /<title>([^<]*)<\/title>/u.exec(html)?.[1]?.trim();
      expect(title).toBe(APP_TITLE);
    },
  );

  test(
    "Shows the custom app title in the browser tab after sign-in",
    { tag: "@cluster-free-capable" },
    async ({ guestPage }) => {
      await expect(guestPage).toHaveTitle(new RegExp(APP_TITLE, "u"));
    },
  );

  for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`${colorScheme} theme`, () => {
      // No theme is stored for a new session, so the app follows prefers-color-scheme.
      test.use({ colorScheme });

      // RHDHBUGS-2046: sidebarItemSelectedBackgroundColor is configurable.
      test(
        "Paints the selected sidebar item with the configured background",
        { tag: "@cluster-free-capable" },
        async ({ guestPage }) => {
          const home = sidebarLink(guestPage, "Home");
          await expect(home).toHaveAttribute("aria-current", "page");
          await expect(home).toHaveCSS(
            "background-color",
            hexToRgb(SIDEBAR_ITEM_SELECTED_BACKGROUND[colorScheme]),
          );
        },
      );

      // RHDHBUGS-2045: the 404 page must not blend into the sidebar.
      test(
        "Renders the 404 page on a different background than the sidebar",
        { tag: "@cluster-free-capable" },
        async ({ guestPage }) => {
          await guestPage.goto("/this-page-does-not-exist");
          const notFound = guestPage.getByTestId("error");
          await expect(notFound).toContainText("404");

          // An unselected item shows the sidebar's own background.
          const home = sidebarLink(guestPage, "Home");
          await expect(home).not.toHaveAttribute("aria-current", "page");

          expect(await paintedBackground(notFound)).not.toBe(await paintedBackground(home));
        },
      );
    });
  }
});
