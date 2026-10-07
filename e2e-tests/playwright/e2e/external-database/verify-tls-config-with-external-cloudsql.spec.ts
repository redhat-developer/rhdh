import { signInAsGuest } from "../../support/auth/guest-auth";
import { test, expect } from "../../support/fixtures/cloudsql-runtime";
import { HomePage } from "../../support/pages/home-page";
import { CLOUD_SQL_ENTITY_URL } from "../../utils/cloudsql-config";
import { waitForRhdhReady } from "../../utils/wait-for-rhdh-ready";

const labels = ["latest-3", "latest-2", "latest-1", "latest"];

for (const [index, label] of labels.entries()) {
  test.describe(`Cloud SQL ${label} via Auth Proxy`, () => {
    test.use({ cloudSqlSlot: index + 1 });
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
      await signInAsGuest(page);
      await new HomePage(page).verifyWelcomeHeading();

      const headers = { Authorization: `Bearer ${cloudSqlRuntime.apiToken}` };
      const register = await request.post("/api/catalog/locations", {
        headers,
        data: { type: "url", target: CLOUD_SQL_ENTITY_URL },
      });
      expect(register.status(), await register.text()).toBe(201);
      const entityPath = `/api/catalog/entities/by-name/component/default/${cloudSqlRuntime.entityName}`;
      await expect
        .poll(async () => (await request.get(entityPath, { headers })).status(), {
          timeout: 120_000,
        })
        .toBe(200);

      const catalog = await cloudSqlRuntime.sql.connect(`${cloudSqlRuntime.databasePrefix}catalog`);
      try {
        const result = await catalog.query<{ entity_ref: string }>(
          "SELECT entity_ref FROM final_entities WHERE entity_ref = $1",
          [`component:default/${cloudSqlRuntime.entityName}`],
        );
        expect(result.rows).toEqual([
          { entity_ref: `component:default/${cloudSqlRuntime.entityName}` },
        ]);
        await testInfo.attach("cloudsql-persistence", {
          body: JSON.stringify(result.rows),
          contentType: "application/json",
        });
      } finally {
        await catalog.end();
      }

      await cloudSqlRuntime.restart();
      await waitForRhdhReady(request, 180_000);
      expect((await request.get(entityPath, { headers })).status()).toBe(200);
    });
  });
}
