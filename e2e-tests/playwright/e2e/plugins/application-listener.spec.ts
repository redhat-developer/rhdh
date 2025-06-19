import { expect } from "@playwright/test";
import { guestTest } from "../../support/fixtures/guest-login";

guestTest.describe("Test ApplicationListener", () => {
  guestTest(
    "Verify that the LocationListener logs the current location",
    async ({ page, uiHelper }) => {
      const logs: string[] = [];

      page.on("console", (msg) => {
        if (msg.type() === "log") {
          logs.push(msg.text());
        }
      });

      await uiHelper.openSidebar("Catalog");

      expect(logs.some((l) => l.includes("pathname: /catalog"))).toBeTruthy();
    },
  );
});
