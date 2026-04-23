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

const coverageRawDir =
  process.env.COVERAGE_OUTPUT_DIR ||
  path.join(process.cwd(), "coverage", "e2e-raw");

const coverageReportDir =
  process.env.COVERAGE_REPORT_DIR ||
  path.join(process.cwd(), "coverage", "e2e");

class CoverageReporter implements Reporter {
  private enabled = process.env.COLLECT_COVERAGE === "true";

  onBegin(): void {
    if (!this.enabled) {
      return;
    }
    console.log(
      `[coverage] COLLECT_COVERAGE=true — raw coverage will be written to ${coverageRawDir}`,
    );
  }

  async onEnd(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    try {
      const files = await fs
        .readdir(coverageRawDir)
        .catch(() => [] as string[]);
      const rawFiles = files.filter((f) => f.endsWith(".json"));
      if (rawFiles.length === 0) {
        console.warn(
          "[coverage] No raw coverage files found. Did any spec use support/coverage/test?",
        );
        return;
      }

      // Dynamic import so this reporter does not force the dep at module-load
      // time (keeps base CI without COLLECT_COVERAGE=true unaffected).
      const monocart = await import("monocart-coverage-reports");

      const report = new monocart.CoverageReport({
        name: "RHDH E2E Coverage",
        outputDir: coverageReportDir,
        reports: [
          ["v8"],
          ["lcov"],
          ["html"],
          ["json-summary"],
          ["console-summary"],
        ],
        cleanCache: true,
      });

      for (const file of rawFiles) {
        const content = await fs.readFile(
          path.join(coverageRawDir, file),
          "utf-8",
        );
        const entries = JSON.parse(content);
        await report.add(entries);
      }

      await report.generate();
      console.log(`[coverage] Merged report written to ${coverageReportDir}`);
    } catch (err) {
      console.error(
        "[coverage] Failed to generate merged coverage report:",
        err,
      );
    }
  }
}

export default CoverageReporter;
