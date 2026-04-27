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
// The merged report goes to coverage/e2e/ and can be uploaded to Codecov with
// the flag `rhdh-e2e-frontend` by a CI step (follow-up).
//
// Dependencies (dev): monocart-coverage-reports

import fs from "node:fs/promises";
import path from "node:path";
import type { Reporter } from "@playwright/test/reporter";
import { COVERAGE_RAW_DIR, COVERAGE_REPORT_DIR } from "./paths";

const generateTimeoutMs = Number(
  process.env.COVERAGE_GENERATE_TIMEOUT_MS || 2 * 60 * 1000,
);

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

class CoverageReporter implements Reporter {
  private enabled = process.env.COLLECT_COVERAGE === "true";

  async onBegin(): Promise<void> {
    if (!this.enabled) {
      return;
    }
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

  async onEnd(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    try {
      const files = await fs.readdir(COVERAGE_RAW_DIR).catch((err: unknown) => {
        // Only swallow "directory does not exist" — any other failure (I/O,
        // permissions) surfaces so CI logs show the actual cause instead of
        // the misleading "no coverage collected" warning below.
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
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

      // Dynamic import defers loading the monocart module until the report
      // is about to be generated. With COLLECT_COVERAGE unset the reporter
      // is not even registered, so this branch is never reached.
      const monocart = await import("monocart-coverage-reports");

      const report = new monocart.CoverageReport({
        name: "RHDH E2E Coverage",
        outputDir: COVERAGE_REPORT_DIR,
        reports: [
          ["v8"],
          ["lcov"],
          ["html"],
          ["json-summary"],
          ["console-summary"],
        ],
        cleanCache: true,
      });

      const entriesPerFile = await Promise.all(
        rawFiles.map(async (file) => {
          const content = await fs.readFile(
            path.join(COVERAGE_RAW_DIR, file),
            "utf-8",
          );
          const parsed: unknown = JSON.parse(content);
          if (!Array.isArray(parsed)) {
            console.warn(
              `[coverage] Skipping ${file}: expected an array of V8 script coverage entries, got ${typeof parsed}`,
            );
            return null;
          }
          return parsed;
        }),
      );

      for (const entries of entriesPerFile) {
        if (entries !== null) {
          await report.add(entries);
        }
      }

      await withTimeout(
        report.generate(),
        generateTimeoutMs,
        "[coverage] report.generate()",
      );
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
