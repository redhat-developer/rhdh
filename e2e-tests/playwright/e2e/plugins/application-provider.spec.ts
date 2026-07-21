import { test } from "@support/coverage/test";

import { waitForLoadingToSettle } from "../../support/auth/app-shell";
import { ApplicationProviderTestPage } from "../../support/pages/application-provider-test-page";

test.describe("Test ApplicationProvider", () => {
  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  let applicationProviderPage: ApplicationProviderTestPage;

  test.beforeEach(({ guestPage }) => {
    applicationProviderPage = new ApplicationProviderTestPage(guestPage);
  });

  // @cluster-free-capable: verified green on the cluster-free harness (playwright.legacy-local.config.ts)
  test(
    "Verify that the TestPage is rendered",
    { tag: "@cluster-free-capable" },
    async ({ guestPage }) => {
      await applicationProviderPage.open();
      await waitForLoadingToSettle(guestPage);
      await applicationProviderPage.verifyTestPageContent();
      await applicationProviderPage.verifyContextOneCard();
      await applicationProviderPage.incrementFirstCardCounter("Context one");
      await applicationProviderPage.verifySharedCardCount("Context one", "1");
      await applicationProviderPage.verifyContextTwoCard();
      await applicationProviderPage.incrementFirstCardCounter("Context two");
      await applicationProviderPage.verifySharedCardCount("Context two", "1");
    },
  );
});
