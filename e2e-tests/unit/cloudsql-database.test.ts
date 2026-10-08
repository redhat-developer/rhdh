import { Client } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  clearCloudSqlDatabases,
  type CloudSqlCleanupClient,
} from "../playwright/utils/cloudsql-database";

const prefix = "csql_012345abcdef_1_";
function result(names: string[]) {
  return {
    rows: names.map((datname) => ({ datname })),
    rowCount: names.length,
    command: "SELECT",
    oid: 0,
    fields: [],
  };
}

describe("owned Cloud SQL cleanup", () => {
  it("refuses broad or invalid prefixes before issuing any SQL", async () => {
    const client: CloudSqlCleanupClient = new Client();
    const query = vi.spyOn(client, "query");
    await expect(clearCloudSqlDatabases(client, "backstage_plugin_")).rejects.toThrow(
      "exact run/slot",
    );
    expect(query).not.toHaveBeenCalled();
  });
  it("uses literal-prefix selection and rejects another run's database even if returned", async () => {
    const client: CloudSqlCleanupClient = new Client();
    const query = vi
      .spyOn(client, "query")
      .mockResolvedValue(result(["csql_abcdef012345_1_catalog"]));
    await expect(clearCloudSqlDatabases(client, prefix)).rejects.toThrow("ownership boundary");
    expect(query).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("starts_with(datname, $1)"),
      [prefix],
    );
  });
  it("propagates drop failures instead of producing a successful cleanup result", async () => {
    const client: CloudSqlCleanupClient = new Client();
    vi.spyOn(client, "query")
      .mockResolvedValueOnce(result([`${prefix}catalog`]))
      .mockRejectedValueOnce(new Error("permission denied"));
    await expect(clearCloudSqlDatabases(client, prefix)).rejects.toThrow("permission denied");
  });
  it("waits for lingering sessions without requiring FORCE or signal privileges", async () => {
    vi.useFakeTimers();
    try {
      const client: CloudSqlCleanupClient = new Client();
      const query = vi
        .spyOn(client, "query")
        .mockResolvedValueOnce(result([`${prefix}catalog`]))
        .mockRejectedValueOnce(
          Object.assign(new Error("database is being accessed"), { code: "55006" }),
        )
        .mockResolvedValueOnce(result([]))
        .mockResolvedValueOnce(result([]));
      const cleanup = expect(clearCloudSqlDatabases(client, prefix)).resolves.toBeUndefined();
      await vi.runAllTimersAsync();
      await cleanup;
      expect(query).toHaveBeenNthCalledWith(3, `DROP DATABASE IF EXISTS "${prefix}catalog"`);
    } finally {
      vi.useRealTimers();
    }
  });
});
