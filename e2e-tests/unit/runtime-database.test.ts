import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readExternalDatabaseInputs,
  runtimeDatabasePrefix,
  clearOwnedDatabases,
  closeDatabaseClients,
  type OwnedDatabaseClient,
} from "../playwright/utils/runtime-database";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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

describe.each(["rt_012345abcdef_rds1_", "rt_012345abcdef_azure1_", "csql_012345abcdef_1_"])(
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
      const literalPrefix: unknown = expect.stringContaining("starts_with(datname, $1)");
      expect(query).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          text: literalPrefix,
          values: [prefix],
        }),
      );
    });
    it("identifies failed drops and preserves their cause", async () => {
      const error = new Error("permission denied");
      const query = vi
        .fn<OwnedDatabaseClient["query"]>()
        .mockResolvedValueOnce(result([`${prefix}catalog`]))
        .mockResolvedValueOnce(result([]))
        .mockRejectedValueOnce(error);
      await expect(clearOwnedDatabases({ query }, prefix)).rejects.toMatchObject({
        message: `Failed to drop owned database ${prefix}catalog`,
        cause: error,
      });
    });
    it("waits beyond the old retry window for sessions without FORCE or signalling", async () => {
      vi.useFakeTimers();
      try {
        const start = Date.now();
        let dropped = false;
        const query = vi.fn<OwnedDatabaseClient["query"]>().mockImplementation((input) => {
          const text = typeof input === "string" ? input : input.text;
          if (text.includes("FROM pg_database"))
            return Promise.resolve(result(dropped ? [] : [`${prefix}catalog`]));
          if (text.startsWith("DROP")) {
            if (Date.now() - start < 40_000)
              return Promise.reject(Object.assign(new Error("busy"), { code: "55006" }));
            dropped = true;
          }
          return Promise.resolve(
            result(
              text.includes("pg_stat_activity") && Date.now() - start < 40_000
                ? [`${prefix}catalog`]
                : [],
            ),
          );
        });
        const cleanup = expect(clearOwnedDatabases({ query }, prefix)).resolves.toBeUndefined();
        await vi.runAllTimersAsync();
        await cleanup;
        expect(dropped).toBe(true);
        expect(
          query.mock.calls
            .map(([input]) => (typeof input === "string" ? input : input.text))
            .join("\n"),
        ).not.toMatch(/FORCE|pg_terminate_backend/u);
      } finally {
        vi.useRealTimers();
      }
    });
    it("fails at a bounded deadline with only owned-session diagnostics", async () => {
      vi.useFakeTimers();
      const query = vi.fn<OwnedDatabaseClient["query"]>().mockImplementation((input) => {
        const text = typeof input === "string" ? input : input.text;
        if (text.startsWith("DROP"))
          return Promise.reject(Object.assign(new Error("busy"), { code: "55006" }));
        return Promise.resolve(result(text.includes("set_config") ? [] : [`${prefix}catalog`]));
      });
      const cleanup = expect(clearOwnedDatabases({ query }, prefix, 5_000)).rejects.toThrow(
        `remaining sessions: [{"datname":"${prefix}catalog"}]`,
      );
      await vi.advanceTimersByTimeAsync(5_000);
      await cleanup;
      const sessionQueries = query.mock.calls
        .map(([input]) => input)
        .filter((input) => typeof input !== "string" && input.text.includes("pg_stat_activity"));
      const boundedTimeout: unknown = expect.any(Number);
      expect(sessionQueries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ values: [prefix], query_timeout: boundedTimeout }),
        ]),
      );
    });
  },
);

it("settles every client close before reporting an individual failure", async () => {
  vi.useFakeTimers();
  const failed = { end: vi.fn<() => Promise<void>>().mockRejectedValue(new Error("close failed")) };
  let closed = false;
  const delayed = {
    end: vi.fn<() => Promise<void>>().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            closed = true;
            resolve();
          }, 50);
        }),
    ),
  };
  const clients = new Set([failed, delayed]);
  const closing = expect(closeDatabaseClients(clients)).rejects.toThrow(
    "SQL clients failed to close",
  );
  await vi.advanceTimersByTimeAsync(50);
  await closing;
  expect(closed).toBe(true);
  expect(clients.size).toBe(0);
});
