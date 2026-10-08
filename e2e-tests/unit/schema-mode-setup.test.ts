import { describe, expect, it } from "vitest";

import { schemaModeDatabaseConfig } from "../playwright/e2e/plugin-division-mode-schema/schema-mode-setup";

describe("schemaModeDatabaseConfig", () => {
  it("disables SSL explicitly for the internal DB, so PGSSLMODE cannot turn it on", () => {
    expect(schemaModeDatabaseConfig(true).connection).toMatchObject({ ssl: false });
  });

  it("uses SSL without CA verification for an external DB", () => {
    expect(schemaModeDatabaseConfig(false).connection).toMatchObject({
      ssl: { rejectUnauthorized: false },
    });
  });

  it("enables schema mode on the database named by POSTGRES_DB", () => {
    expect(schemaModeDatabaseConfig(true)).toMatchObject({
      client: "pg",
      pluginDivisionMode: "schema",
      ensureSchemaExists: true,
      connection: { database: "${POSTGRES_DB}" },
    });
  });
});
