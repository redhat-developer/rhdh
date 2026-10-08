import { describe, expect, it } from "vitest";

import {
  runtimeCoverageProblem,
  type RuntimeCoverageCase,
} from "../playwright/support/runtime-reporter";
import {
  readExternalDatabaseInputs,
  runtimeDatabasePrefix,
  clearOwnedDatabases,
  type OwnedDatabaseClient,
} from "../playwright/utils/runtime-database";

function successfulCoverage(): RuntimeCoverageCase[] {
  return Object.entries({
    "config-map.spec.ts": 1,
    "verify-tls-config-with-external-azure-db.spec.ts": 8,
    "verify-tls-config-with-external-rds.spec.ts": 8,
    "verify-tls-config-with-external-cloudsql.spec.ts": 4,
    "verify-schema-mode.spec.ts": 2,
  }).flatMap(([file, count]) =>
    Array.from({ length: count }, (_, index) => ({
      title: `${file}/${index}`,
      titlePath: () => ["showcase-runtime", `external-database/${file}`],
      results: [{ status: "passed" as const }],
    })),
  );
}

describe("required runtime coverage", () => {
  it("accepts all 23 successful cases and rejects missing, skipped and retried coverage", () => {
    const tests = successfulCoverage();
    expect(tests).toHaveLength(23);
    expect(runtimeCoverageProblem(tests)).toBeUndefined();
    expect(runtimeCoverageProblem(tests.slice(1))).toContain("selected 0/1");
    tests[0].results[0].status = "skipped";
    expect(runtimeCoverageProblem(tests)).toContain("without skips or retries");
    tests[0].results[0].status = "passed";
    tests[0].results.push(tests[0].results[0]);
    expect(runtimeCoverageProblem(tests)).toContain("without skips or retries");
  });
  it("fails missing required inputs before any database connection, with optional local skips only", () => {
    expect(readExternalDatabaseInputs("rds", 1, {})).toBeNull();
    expect(() => readExternalDatabaseInputs("rds", 1, { RUNTIME_REQUIRED: "true" })).toThrow(
      "Required rds slot 1",
    );
    expect(() => readExternalDatabaseInputs("azure", 2, { AZURE_DB_1_HOST: "one.test" })).toThrow(
      "Required azure slot 2",
    );
    expect(() =>
      readExternalDatabaseInputs("rds", 1, {
        RDS_1_HOST: "one.test",
        RDS_USER: "user",
        RDS_PASSWORD: "fake",
      }),
    ).toThrow("CA bundle");
  });
});

describe("provider database ownership", () => {
  it("separates providers and slots and never interprets underscores as SQL wildcards", async () => {
    const rds = runtimeDatabasePrefix("012345abcdef", "rds", 1);
    expect(rds).not.toBe(runtimeDatabasePrefix("012345abcdef", "azure", 1));
    expect(rds).not.toBe(runtimeDatabasePrefix("012345abcdef", "rds", 2));
    const queries: string[] = [];
    const client: OwnedDatabaseClient = {
      query(text) {
        queries.push(text);
        return Promise.resolve({ rows: [{ datname: "rt_abcdef012345_rds1_catalog" }] });
      },
    };
    await expect(clearOwnedDatabases(client, rds)).rejects.toThrow("ownership boundary");
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("starts_with(datname, $1)");
    await expect(clearOwnedDatabases(client, "backstage_plugin_")).rejects.toThrow(
      "exact run/slot",
    );
    expect(queries).toHaveLength(1);
  });
});
