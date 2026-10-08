import type { ExternalDatabaseProvider } from "../../utils/runtime-database";
import { waitForRhdhReady } from "../../utils/wait-for-rhdh-ready";
import { signInAsGuest } from "../auth/guest-auth";
import { HomePage } from "../pages/home-page";
import { test, expect } from "./external-postgres-runtime";

/** Both providers retain the configure/restart and guest-session tests per slot. */
export function defineExternalPostgresTests(provider: ExternalDatabaseProvider): void {
  const name = provider === "rds" ? "RDS" : "Azure DB";
  for (const [index, label] of ["latest-3", "latest-2", "latest-1", "latest"].entries()) {
    test.describe.serial(`${name} ${label} PostgreSQL version`, () => {
      test.use({ externalTarget: { provider, slot: index + 1 } });
      test("Configure and restart deployment", async ({ externalRuntime, request }, info) => {
        test.setTimeout(900_000);
        if (!externalRuntime) throw new Error("External runtime fixture unavailable");
        await externalRuntime.restart();
        await waitForRhdhReady(request, 180_000);
        const admin = await externalRuntime.connect();
        try {
          const sessions = await admin.query<{ datname: string; ssl: boolean }>(
            "SELECT a.datname, s.ssl FROM pg_stat_activity a JOIN pg_stat_ssl s ON s.pid = a.pid WHERE starts_with(a.datname, $1) AND a.backend_type = 'client backend'",
            [externalRuntime.databasePrefix],
          );
          expect(sessions.rows.length).toBeGreaterThan(0);
          expect(sessions.rows.every((session) => session.ssl)).toBe(true);
          await info.attach("runtime-database-tls", {
            body: JSON.stringify(sessions.rows),
            contentType: "application/json",
          });
        } finally {
          await admin.end();
        }
      });
      test("Verify successful DB connection", async ({ externalRuntime, page, request }, info) => {
        if (!externalRuntime) throw new Error("External runtime fixture unavailable");
        await waitForRhdhReady(request, 180_000);
        await signInAsGuest(page);
        await new HomePage(page).verifyWelcomeHeading();
        const catalog = await externalRuntime.connect(`${externalRuntime.databasePrefix}catalog`);
        try {
          const result = await catalog.query<{ database: string; migrations: string }>(
            "SELECT current_database() AS database, (SELECT count(*) FROM knex_migrations) AS migrations",
          );
          expect(result.rows[0].database).toBe(`${externalRuntime.databasePrefix}catalog`);
          expect(Number(result.rows[0].migrations)).toBeGreaterThan(0);
          await info.attach("runtime-database-migrations", {
            body: JSON.stringify(result.rows),
            contentType: "application/json",
          });
        } finally {
          await catalog.end();
        }
      });
    });
  }
}
