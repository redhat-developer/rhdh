import { signInAsGuest } from "../../support/auth/guest-auth";
import { test } from "../../support/fixtures/cloudsql-runtime";
import { verifyCatalogPersistence } from "../../support/harnesses/runtime-catalog-persistence";
import { HomePage } from "../../support/pages/home-page";
import { waitForRhdhReady } from "../../utils/wait-for-rhdh-ready";

test.beforeAll(({}, testInfo) => {
  testInfo.annotations.push({ type: "component", description: "data-management" });
});

for (const slot of [1, 2, 3, 4]) {
  test.describe(`Cloud SQL slot ${slot} via Auth Proxy`, () => {
    test.use({ cloudSqlSlot: slot });
    test.beforeEach(async ({ request }) => {
      // request's baseURL depends on the Cloud SQL fixture, before a browser is needed.
      await waitForRhdhReady(request, 180_000);
    });

    test("persists catalog data and retains it after an RHDH restart", async ({
      page,
      request,
      cloudSqlRuntime,
    }, testInfo) => {
      test.setTimeout(900_000);
      await verifyCatalogPersistence(request, cloudSqlRuntime, testInfo);
      await signInAsGuest(page, { baseURL: cloudSqlRuntime.baseURL });
      await new HomePage(page).verifyWelcomeHeading();
    });
  });
}
