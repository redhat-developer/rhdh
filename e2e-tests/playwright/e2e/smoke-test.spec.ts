import { test } from "@support/coverage/test";

import { HomePage } from "../support/pages/home-page";

test.describe("Smoke test", { tag: "@smoke" }, () => {
  let homePage: HomePage;

  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
  });

  test.beforeEach(({ guestPage }) => {
    homePage = new HomePage(guestPage);
  });

  test("Verify the RHDH instance homepage renders", { tag: "@cluster-free-capable" }, async () => {
    await homePage.verifyWelcomeHeading();
  });
});
