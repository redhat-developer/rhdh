import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readExternalDatabaseInputs,
  runtimeDatabasePrefix,
  clearOwnedDatabases,
  clearSlotDatabases,
  closeDatabaseClients,
  dropOwnedDatabases,
  newRuntimeRunId,
  RUNTIME_DATABASE_CLEANUP_TIMEOUT_MS,
  RUNTIME_RUN_MAX_AGE_MS,
  type OwnedDatabaseClient,
} from "../playwright/utils/runtime-database";

/** A whole second, so a run id's start time round-trips exactly. */
const FIXED_NOW = Date.UTC(2026, 9, 21, 5, 30);

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

describe.each(["rt_012345abcdef_rds1_", "csql_012345abcdef_1_"])(
  "%s owned database cleanup",
  (prefix) => {
    it("rejects another run's database even if returned", async () => {
      const query = vi
        .fn<OwnedDatabaseClient["query"]>()
        .mockResolvedValue(result([`${prefix.replace("012345abcdef", "abcdef012345")}catalog`]));
      await expect(clearOwnedDatabases({ query }, prefix)).rejects.toThrow("ownership boundary");
    });
  },
);

// The same cleanup engine handles every prefix; exercise its failures and deadlines once.
describe("owned database cleanup failures", () => {
  const prefix = "rt_012345abcdef_rds1_";
  it("refuses broad or invalid prefixes before issuing SQL", async () => {
    const query = vi.fn<OwnedDatabaseClient["query"]>();
    await expect(clearOwnedDatabases({ query }, "backstage_plugin_")).rejects.toThrow(
      "exact run/slot",
    );
    expect(query).not.toHaveBeenCalled();
  });
  it("waits for active sessions without FORCE, ending only its own role's sessions", async () => {
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
      const sql = query.mock.calls.map(([input]) =>
        typeof input === "string" ? input : input.text,
      );
      expect(sql.join("\n")).not.toMatch(/FORCE/u);
      const terminations = sql.filter((text) => text.includes("pg_terminate_backend"));
      expect(terminations.length).toBeGreaterThan(0);
      for (const text of terminations) expect(text).toContain("usename = current_user");
    } finally {
      vi.useRealTimers();
    }
  });
  it("drops a database whose only sessions are its role's orphans from a stopped pod", async () => {
    vi.useFakeTimers();
    try {
      let orphans = true;
      let databases = [`${prefix}catalog`];
      const query = vi.fn<OwnedDatabaseClient["query"]>().mockImplementation((input) => {
        const text = typeof input === "string" ? input : input.text;
        if (text.includes("pg_terminate_backend")) orphans = false;
        if (text.startsWith("DROP")) {
          if (orphans) return Promise.reject(Object.assign(new Error("busy"), { code: "55006" }));
          databases = [];
        }
        if (text.includes("FROM pg_database")) return Promise.resolve(result(databases));
        if (text.includes("pg_stat_activity") && !text.includes("pg_terminate_backend"))
          return Promise.resolve(result(orphans ? [`${prefix}catalog`] : []));
        return Promise.resolve(result([]));
      });
      const cleanup = expect(
        clearOwnedDatabases({ query }, prefix, 10_000),
      ).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(10_000);
      await cleanup;
      expect(databases).toEqual([]);
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
  });
});

it("preserves drop outcomes and session diagnostics when admin shutdown fails", async () => {
  vi.useFakeTimers();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const prefix = "rt_012345abcdef_rds1_";
  const busyError = Object.assign(new Error("busy"), { code: "55006" });
  let busy = true;
  let databases = [`${prefix}catalog`];
  const query = vi.fn<OwnedDatabaseClient["query"]>().mockImplementation((input) => {
    const text = typeof input === "string" ? input : input.text;
    if (text.startsWith("DROP")) {
      if (busy) return Promise.reject(busyError);
      databases = [];
    }
    return Promise.resolve(result(text.includes("set_config") ? [] : databases));
  });
  const end = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("shutdown timed out"));
  const connect = () => Promise.resolve({ query, end });
  const dropping = dropOwnedDatabases(connect, prefix).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(RUNTIME_DATABASE_CLEANUP_TIMEOUT_MS);
  const error = await dropping;
  expect(error).toBeInstanceOf(AggregateError);
  expect(String(error)).toContain(`remaining sessions: [{"datname":"${prefix}catalog"}]`);
  expect(error).toMatchObject({ errors: [busyError, expect.any(Error)] });

  busy = false;
  await expect(dropOwnedDatabases(connect, prefix)).resolves.toBeUndefined();
  expect(databases).toEqual([]);
  expect(end).toHaveBeenCalledTimes(2);
  expect(warn).toHaveBeenCalledTimes(2);
  expect(warn.mock.calls.flat().join(" ")).toContain("shutdown timed out");
});

describe.each([
  [
    "rt_012345abcdef_rds1_",
    "rt_abcdef012345_rds1_",
    ["rt_abcdef012345_rds2_", "rt_abcdef012345_azure1_"],
  ],
  [
    "csql_012345abcdef_1_",
    "csql_abcdef012345_1_",
    ["csql_abcdef012345_2_", "rt_abcdef012345_rds1_"],
  ],
])("%s slot cleanup", (current, stale, otherSlots) => {
  /** In-memory pg_database that ignores the server-side pattern, so the client must enforce it. */
  function fakeServer(names: string[], failDropsFor?: string) {
    const databases = new Set(names);
    const query = vi.fn<OwnedDatabaseClient["query"]>().mockImplementation((input, values) => {
      const text = typeof input === "string" ? input : input.text;
      const args = typeof input === "string" ? values : input.values;
      if (text.includes("datname ~")) return Promise.resolve(result([...databases]));
      if (text.includes("starts_with"))
        return Promise.resolve(
          result([...databases].filter((name) => name.startsWith(args?.[0] ?? "\0"))),
        );
      const dropped = /^DROP DATABASE IF EXISTS "(.+)"$/u.exec(text)?.[1];
      if (dropped !== undefined) {
        if (failDropsFor !== undefined && dropped.startsWith(failDropsFor))
          return Promise.reject(new Error("permission denied"));
        databases.delete(dropped);
      }
      return Promise.resolve(result([]));
    });
    return { databases, query };
  }
  const unrelated = [
    ...otherSlots.map((prefix) => `${prefix}catalog`),
    `${stale.replace("abcdef012345", "abcdef01234")}catalog`,
    "rt_x_rds1_catalog",
    "backstage_plugin_catalog",
  ];

  it("retires only exact same-slot leftovers from other runs and clears the current run", async () => {
    const server = fakeServer([
      `${stale}catalog`,
      `${stale}auth`,
      `${current}catalog`,
      ...unrelated,
    ]);
    await expect(clearSlotDatabases({ query: server.query }, current)).resolves.toEqual({
      retired: [stale],
      failed: [],
      active: [],
    });
    expect([...server.databases]).toEqual(unrelated);
  });

  it("only warns for another run's leftovers but fails for the current run", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = fakeServer([`${stale}catalog`, `${current}catalog`], stale);
    await expect(clearSlotDatabases({ query: server.query }, current)).resolves.toEqual({
      retired: [],
      failed: [stale],
      active: [],
    });
    expect([...server.databases]).toEqual([`${stale}catalog`]);
    const failing = fakeServer([`${current}catalog`], current);
    await expect(clearSlotDatabases({ query: failing.query }, current)).rejects.toThrow(
      `Failed to drop owned database ${current}catalog`,
    );
  });

  it("leaves another run on the slot alone while it may still be running", async () => {
    const now = FIXED_NOW;
    const margin = 60_000;
    const clockAhead = 30_000;
    const startedAgo = (ms: number) => stale.replace("abcdef012345", newRuntimeRunId(now - ms));
    const young = startedAgo(RUNTIME_RUN_MAX_AGE_MS - margin);
    const skewed = startedAgo(-clockAhead);
    const old = startedAgo(RUNTIME_RUN_MAX_AGE_MS + margin);
    const server = fakeServer([
      `${young}catalog`,
      `${skewed}catalog`,
      `${old}catalog`,
      `${current}catalog`,
    ]);
    await expect(clearSlotDatabases({ query: server.query }, current, now)).resolves.toEqual({
      retired: [old],
      failed: [],
      active: [young, skewed],
    });
    expect([...server.databases]).toEqual([`${young}catalog`, `${skewed}catalog`]);
  });
});

it("starts each run id with its start time so other runs can tell its age", () => {
  const now = FIXED_NOW;
  const lastMsOfSecond = 999;
  const runId = newRuntimeRunId(now + lastMsOfSecond);
  expect(runId).toMatch(/^[a-f0-9]{12}$/u);
  expect(Number.parseInt(runId.slice(0, 8), 16) * 1000).toBe(now);
  expect(runtimeDatabasePrefix(runId, "rds", 1)).toBe(`rt_${runId}_rds1_`);
});

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
