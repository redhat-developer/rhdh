import type { FullResult, Reporter, Suite, TestCase } from "@playwright/test/reporter";

import { runtimeCoverageRequired } from "../utils/runtime-database";

const expectedFiles: Record<string, number> = {
  "config-map.spec.ts": 1,
  "verify-tls-config-with-external-azure-db.spec.ts": 8,
  "verify-tls-config-with-external-rds.spec.ts": 8,
  "verify-tls-config-with-external-cloudsql.spec.ts": 4,
  "verify-schema-mode.spec.ts": 2,
};

export type RuntimeCoverageCase = Pick<TestCase, "title" | "titlePath"> & {
  results: Array<Pick<TestCase["results"][number], "status">>;
};

export function runtimeCoverageProblem(
  tests: ReadonlyArray<RuntimeCoverageCase>,
): string | undefined {
  for (const [file, count] of Object.entries(expectedFiles)) {
    const actual = tests.filter((test) =>
      test.titlePath().some((part) => part.endsWith(file)),
    ).length;
    if (actual !== count)
      return `Required runtime coverage: ${file} selected ${actual}/${count} tests`;
  }
  const incomplete = tests.filter(
    (test) => test.results.length !== 1 || test.results[0].status !== "passed",
  );
  if (incomplete.length > 0)
    return `Required runtime coverage must pass without skips or retries: ${incomplete.map((test) => test.title).join(", ")}`;
  return undefined;
}

export default class RuntimeReporter implements Reporter {
  private tests: TestCase[] = [];
  private enabled = false;

  onBegin(_config: unknown, suite: Pick<Suite, "allTests">): void {
    this.tests = suite
      .allTests()
      .filter((test) => test.parent.project()?.name === "showcase-runtime");
    this.enabled =
      runtimeCoverageRequired() &&
      !process.argv.includes("--list") &&
      (this.tests.length > 0 || process.argv.some((arg) => arg.includes("showcase-runtime")));
  }

  onEnd(result: FullResult): Promise<{ status: FullResult["status"] }> {
    const problem = this.enabled ? runtimeCoverageProblem(this.tests) : undefined;
    if (problem !== undefined) console.error(problem);
    return Promise.resolve({ status: problem === undefined ? result.status : "failed" });
  }
}
