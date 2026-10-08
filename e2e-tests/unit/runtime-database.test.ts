import { describe, expect, it } from "vitest";

import {
  runtimeDatabasePrefix,
  clearOwnedDatabases,
  type OwnedDatabaseClient,
} from "../playwright/utils/runtime-database";

describe("provider database ownership", () => {
  it("isolates providers and slots and refuses cleanup outside the exact run prefix", async () => {
    const prefix = runtimeDatabasePrefix("012345abcdef", "rds", 1);
    expect(prefix).not.toBe(runtimeDatabasePrefix("012345abcdef", "azure", 1));
    expect(prefix).not.toBe(runtimeDatabasePrefix("012345abcdef", "rds", 2));
    const queries: string[] = [];
    const client: OwnedDatabaseClient = {
      query(text) {
        queries.push(text);
        return Promise.resolve({ rows: [{ datname: "rt_abcdef012345_rds1_catalog" }] });
      },
    };
    await expect(clearOwnedDatabases(client, prefix)).rejects.toThrow("ownership boundary");
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("starts_with(datname, $1)");
    await expect(clearOwnedDatabases(client, "backstage_plugin_")).rejects.toThrow(
      "exact run/slot",
    );
    expect(queries).toHaveLength(1);
  });
});
