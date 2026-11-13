import { test, expect } from "@support/coverage/test";

import { getRhdhSidebarLink } from "../support/navigation/rhdh-sidebar-adapter";
import { APP_TITLE, SIDEBAR_ITEM_SELECTED_BACKGROUND } from "../support/test-data/branding";
import { getPaintedBackground, hexToRgb } from "../utils/ui-helper/styles";

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
    "Verify the served HTML carries the custom app title before the app loads",
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
    "Verify the browser tab shows the custom app title after sign-in",
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
        "Verify the selected sidebar item uses the configured background",
        { tag: "@cluster-free-capable" },
        async ({ guestPage }) => {
          const home = getRhdhSidebarLink(guestPage, "Home");
          await expect(home).toHaveAttribute("aria-current", "page");
          await expect(home).toHaveCSS(
            "background-color",
            hexToRgb(SIDEBAR_ITEM_SELECTED_BACKGROUND[colorScheme]),
          );
        },
      );

      // RHDHBUGS-2045: the 404 page must not blend into the sidebar.
      test(
        "Verify the 404 page background differs from the sidebar background",
        { tag: "@cluster-free-capable" },
        async ({ guestPage }) => {
          await guestPage.goto("/this-page-does-not-exist");
          const notFound = guestPage.getByTestId("error");
          await expect(notFound).toContainText("404");

          // An unselected item shows the sidebar's own background.
          const home = getRhdhSidebarLink(guestPage, "Home");
          await expect(home).not.toHaveAttribute("aria-current", "page");
          const sidebarBackground = await getPaintedBackground(home);

          await expect.poll(() => getPaintedBackground(notFound)).not.toBe(sidebarBackground);
        },
      );
    });
  }
});
