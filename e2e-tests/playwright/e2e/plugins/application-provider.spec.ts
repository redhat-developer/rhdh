import { test } from "@support/coverage/test";

import { ApplicationProviderTestPage } from "../../support/pages/application-provider-test-page";
import { Common } from "../../utils/common";

test.describe("Test ApplicationProvider", () => {
  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  let applicationProviderPage: ApplicationProviderTestPage;
  let common: Common;

  test.beforeEach(async ({ page }) => {
    common = new Common(page);
    applicationProviderPage = new ApplicationProviderTestPage(page);
    await common.loginAsGuest();
  });

  test("Verify that the TestPage is rendered", async () => {
    await applicationProviderPage.open();
    await common.waitForLoad();
    await applicationProviderPage.verifyTestPageContent();
    await applicationProviderPage.verifyContextOneCard();
    await applicationProviderPage.incrementFirstCardCounter("Context one");
    await applicationProviderPage.verifySharedCardCount("Context one", "1");
    await applicationProviderPage.verifyContextTwoCard();
    await applicationProviderPage.incrementFirstCardCounter("Context two");
    await applicationProviderPage.verifySharedCardCount("Context two", "1");
  });
});
