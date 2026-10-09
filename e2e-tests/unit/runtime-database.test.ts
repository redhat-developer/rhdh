import { describe, expect, it, vi } from "vitest";

import {
  readExternalDatabaseInputs,
  runtimeDatabasePrefix,
  clearOwnedDatabases,
  type OwnedDatabaseClient,
} from "../playwright/utils/runtime-database";

describe.each(["rds", "azure"] as const)("%s optional runtime inputs", (provider) => {
  const root = provider === "rds" ? "RDS" : "AZURE_DB";
  it("skips an absent or blank slot even when a sibling is configured", () => {
    expect(readExternalDatabaseInputs(provider, 1, {})).toBeNull();
    const env = { [`${root}_1_HOST`]: "configured.example.test" };
    expect(readExternalDatabaseInputs(provider, 2, env)).toBeNull();
    expect(readExternalDatabaseInputs(provider, 2, { ...env, [`${root}_2_HOST`]: " " })).toBeNull();
  });
  it("rejects supplied hosts without credentials or a CA bundle", () => {
    const env = { [`${root}_1_HOST`]: "configured.example.test" };
    expect(() => readExternalDatabaseInputs(provider, 1, env)).toThrow("needs user and password");
    expect(() =>
      readExternalDatabaseInputs(provider, 1, {
        ...env,
        [`${root}_USER`]: "user",
        [`${root}_PASSWORD`]: "fake",
      }),
    ).toThrow("CA bundle");
  });
});

describe("provider database ownership", () => {
  it("isolates providers and slots", () => {
    const prefix = runtimeDatabasePrefix("012345abcdef", "rds", 1);
    expect(prefix).not.toBe(runtimeDatabasePrefix("012345abcdef", "azure", 1));
    expect(prefix).not.toBe(runtimeDatabasePrefix("012345abcdef", "rds", 2));
  });
});

function result(names: string[]) {
  return { rows: names.map((datname) => ({ datname })) };
}

describe.each(["rt_012345abcdef_rds1_", "csql_012345abcdef_1_"])(
  "%s owned database cleanup",
  (prefix) => {
    it("refuses broad or invalid prefixes before issuing SQL", async () => {
      const query = vi.fn<OwnedDatabaseClient["query"]>();
      const client = { query };
      await expect(clearOwnedDatabases(client, "backstage_plugin_")).rejects.toThrow(
        "exact run/slot",
      );
      expect(query).not.toHaveBeenCalled();
    });
    it("uses literal-prefix selection and rejects another run's database even if returned", async () => {
      const query = vi
        .fn<OwnedDatabaseClient["query"]>()
        .mockResolvedValue(result([`${prefix.replace("012345abcdef", "abcdef012345")}catalog`]));
      await expect(clearOwnedDatabases({ query }, prefix)).rejects.toThrow("ownership boundary");
      expect(query).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining("starts_with(datname, $1)"),
        [prefix],
      );
    });
    it("identifies failed drops and preserves their cause", async () => {
      const error = new Error("permission denied");
      const query = vi
        .fn<OwnedDatabaseClient["query"]>()
        .mockResolvedValueOnce(result([`${prefix}catalog`]))
        .mockRejectedValueOnce(error);
      await expect(clearOwnedDatabases({ query }, prefix)).rejects.toMatchObject({
        message: `Failed to drop owned database ${prefix}catalog`,
        cause: error,
      });
    });
    it("waits for lingering sessions without requiring FORCE or signal privileges", async () => {
      vi.useFakeTimers();
      try {
        const query = vi
          .fn<OwnedDatabaseClient["query"]>()
          .mockResolvedValueOnce(result([`${prefix}catalog`]))
          .mockRejectedValueOnce(
            Object.assign(new Error("database is being accessed"), { code: "55006" }),
          )
          .mockResolvedValueOnce(result([]))
          .mockResolvedValueOnce(result([]));
        const cleanup = expect(clearOwnedDatabases({ query }, prefix)).resolves.toBeUndefined();
        await vi.runAllTimersAsync();
        await cleanup;
        expect(query).toHaveBeenNthCalledWith(3, `DROP DATABASE IF EXISTS "${prefix}catalog"`);
      } finally {
        vi.useRealTimers();
      }
    });
  },
);
