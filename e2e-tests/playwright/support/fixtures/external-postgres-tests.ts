import type { ExternalDatabaseProvider } from "../../utils/runtime-database";
import { waitForRhdhReady } from "../../utils/wait-for-rhdh-ready";
import { signInAsGuest } from "../auth/guest-auth";
import { verifyCatalogPersistence } from "../harnesses/runtime-catalog-persistence";
import { HomePage } from "../pages/home-page";
import { test, expect } from "./external-postgres-runtime";

/** Both direct-TLS providers exercise the same catalog write/offline/read contract. */
export function defineExternalPostgresTests(provider: ExternalDatabaseProvider): void {
  test.beforeAll(({ browserName: _browserName }, info) => {
    info.annotations.push({ type: "component", description: "data-management" });
  });
  const name = provider === "rds" ? "RDS" : "Azure DB";
  for (const slot of [1, 2, 3, 4]) {
    test.describe(`${name} PostgreSQL slot ${slot}`, () => {
      test.use({ externalTarget: { provider, slot } });
      test("retains catalog data across restart with TLS database sessions", async ({
        externalRuntime,
        request,
        page,
      }, info) => {
        test.setTimeout(900_000);
        await waitForRhdhReady(request, 180_000);
        await verifyCatalogPersistence(request, externalRuntime, info);
        await test.step("Verify application database sessions use TLS after restart", async () => {
          const admin = await externalRuntime.connect();
          try {
            const sessions = await admin.query<{ datname: string; ssl: boolean | null }>(
              "SELECT a.datname, s.ssl FROM pg_stat_activity a LEFT JOIN pg_stat_ssl s ON s.pid = a.pid WHERE starts_with(a.datname, $1) AND a.backend_type = 'client backend' AND a.application_name <> 'rhdh-runtime-probe'",
              [externalRuntime.databasePrefix],
            );
            expect(
              sessions.rows.some(
                (session) => session.datname === `${externalRuntime.databasePrefix}catalog`,
              ),
            ).toBe(true);
            expect(sessions.rows.every((session) => session.ssl === true)).toBe(true);
            await info.attach("runtime-database-tls", {
              body: JSON.stringify(sessions.rows),
              contentType: "application/json",
            });
          } finally {
            await admin.end();
          }
        });
        // Exercise certificate rejection once per provider rather than on every version slot.
        if (slot === 1) {
          await test.step("Reject an unrelated CA in the RHDH database connection", async () => {
            await externalRuntime.verifyUntrustedCa();
            await waitForRhdhReady(request, 180_000);
          });
        }
        await test.step("Verify a guest session on the restarted application", async () => {
          await signInAsGuest(page, { baseURL: externalRuntime.baseURL });
          await new HomePage(page).verifyWelcomeHeading();
        });
      });
    });
  }
}
