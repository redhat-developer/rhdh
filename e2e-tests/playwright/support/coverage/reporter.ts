// Jira: RHIDP-13243 — Playwright coverage reporter for rhdh E2E runs
// Feature umbrella: RHDHPLAN-851, Epic: RHIDP-13242
//
// Playwright reporter that, at the end of the run, reads the per-test V8
// coverage JSON files written by the coverage fixture (support/coverage/test.ts)
// and produces a merged Istanbul-format LCOV report plus an HTML report.
//
// Activated only when COLLECT_COVERAGE=true. When inactive, the reporter is
// a no-op so the default reporter set (html, list, junit) is unaffected.
//
// The merged report goes to coverage/e2e/, limited to packages/app sources and
// named by repository path (see source-paths.ts), and testing.sh uploads it to
// Codecov with the flag `rhdh-e2e-frontend`.
//
// Dependencies (dev): monocart-coverage-reports

import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { Reporter } from "@playwright/test/reporter";
import { CoverageReport } from "monocart-coverage-reports";

import { COVERAGE_RAW_DIR, COVERAGE_REPORT_DIR } from "./paths";
import { SourceMapLoader } from "./source-maps";
import { coverageSourceOptions } from "./source-paths";

const generateTimeoutMs = Number(
  process.env.COVERAGE_GENERATE_TIMEOUT_MS ?? 2 * 60 * 1000,
);
const mergeTimeoutMs = Number(
  process.env.COVERAGE_MERGE_TIMEOUT_MS ?? 5 * 60 * 1000,
);

function isENOENT(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === "ENOENT"
  );
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  const timeout = sleep(timeoutMs, undefined, { signal: controller.signal })
    .then((): never => {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    })
    .catch((error: unknown) => {
      if (controller.signal.aborted) {
        return new Promise<never>(() => {});
      }
      throw error;
    });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    controller.abort();
  }
}

/**
 * Add each raw coverage file to the report, one at a time: each holds the full text
 * of every bundle the page loaded (~6 MB per test against the showcase image), so
 * parsing them all up front multiplies peak memory by the number of tests. Only the
 * app's bundles with a loadable source map are added (see source-maps.ts).
 */
export async function mergeRawCoverage(
  report: { add: (entries: unknown[]) => Promise<unknown> },
  rawFiles: string[],
  sourceMaps: SourceMapLoader,
  signal?: AbortSignal,
): Promise<void> {
  for (const file of rawFiles) {
    signal?.throwIfAborted();
    const content = await fs.readFile(
      path.join(COVERAGE_RAW_DIR, file),
      "utf-8",
    );
    const parsed: unknown = JSON.parse(content);
    if (!isUnknownArray(parsed)) {
      console.warn(
        `[coverage] Skipping ${file}: expected an array of V8 script coverage entries, got ${typeof parsed}`,
      );
      continue;
    }
    const entries = await sourceMaps.attach(parsed);
    signal?.throwIfAborted();
    await report.add(entries);
  }
  if (sourceMaps.failures.length > 0) {
    console.warn(
      `[coverage] ${sourceMaps.failures.length} source map(s) could not be loaded; their bundles are left out of the report.`,
    );
  }
}

/**
 * Merge, then generate, each under its own budget: slow source-map fetches must not
 * use up the time report generation needs. A merge that times out stops adding.
 */
export async function buildReport<T>(
  report: {
    add: (entries: unknown[]) => Promise<unknown>;
    generate: () => Promise<T>;
  },
  rawFiles: string[],
  sourceMaps: SourceMapLoader,
): Promise<T> {
  const merging = new AbortController();
  try {
    await withTimeout(
      mergeRawCoverage(report, rawFiles, sourceMaps, merging.signal),
      mergeTimeoutMs,
      "[coverage] merging raw coverage",
    );
  } finally {
    merging.abort();
  }
  return withTimeout(
    report.generate(),
    generateTimeoutMs,
    "[coverage] report.generate()",
  );
}

class CoverageReporter implements Reporter {
  private enabled = process.env.COLLECT_COVERAGE === "true";

  // Playwright Reporter hooks accept Promise<void>; oxlint's void-only rule is stricter than upstream types.
  // oxlint-disable-next-line typescript/no-misused-promises, typescript/strict-void-return
  onBegin(): Promise<void> {
    if (!this.enabled) {
      return Promise.resolve();
    }
    return this.prepareRawDir();
  }

  // oxlint-disable-next-line typescript/no-misused-promises, typescript/strict-void-return
  onEnd(): Promise<void> {
    if (!this.enabled) {
      return Promise.resolve();
    }
    return this.generateReport();
  }

  private async prepareRawDir(): Promise<void> {
    // Clear any raw coverage left over from a previous run so the merged
    // report only reflects the current Playwright run. Without this the
    // reporter would accumulate stale *.json files across runs and produce
    // an incorrect LCOV/HTML report.
    try {
      await fs.rm(COVERAGE_RAW_DIR, { recursive: true, force: true });
      await fs.mkdir(COVERAGE_RAW_DIR, { recursive: true });
    } catch (err) {
      console.warn("[coverage] Failed to reset raw coverage dir:", err);
    }
    console.log(
      `[coverage] COLLECT_COVERAGE=true — raw coverage will be written to ${COVERAGE_RAW_DIR}`,
    );
  }

  private async generateReport(): Promise<void> {
    try {
      const files = await fs.readdir(COVERAGE_RAW_DIR).catch((err: unknown) => {
        // Only swallow "directory does not exist" — any other failure (I/O,
        // permissions) surfaces so CI logs show the actual cause instead of
        // the misleading "no coverage collected" warning below.
        if (isENOENT(err)) {
          return [] as string[];
        }
        throw err;
      });
      const rawFiles = files.filter((f) => f.endsWith(".json"));
      if (rawFiles.length === 0) {
        console.warn(
          "[coverage] No raw coverage files found. Did any spec use support/coverage/test?",
        );
        return;
      }

      const report = new CoverageReport({
        name: "RHDH E2E Coverage",
        outputDir: COVERAGE_REPORT_DIR,
        reports: [["lcov"], ["html"], ["json-summary"], ["console-summary"]],
        cleanCache: true,
        ...coverageSourceOptions,
      });

      const results = await buildReport(
        report,
        rawFiles,
        new SourceMapLoader(),
      );
      if ((results?.files.length ?? 0) === 0) {
        console.warn(
          "[coverage] The report names no packages/app source. Were the app's source maps reachable?",
        );
      }
      console.log(`[coverage] Merged report written to ${COVERAGE_REPORT_DIR}`);
    } catch (err) {
      console.error(
        "[coverage] Failed to generate merged coverage report:",
        err,
      );
    }
  }
}

export default CoverageReporter;
