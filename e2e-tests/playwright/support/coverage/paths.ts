// Jira: RHIDP-13243 — Shared coverage paths for fixture and reporter
// Feature umbrella: RHDHPLAN-851, Epic: RHIDP-13242
//
// Single source of truth for the two filesystem locations used by the
// coverage pipeline. Importing from here keeps the fixture (test.ts) and
// the reporter (reporter.ts) in lockstep if the env-var names or default
// paths ever change.

import path from "node:path";

export const COVERAGE_RAW_DIR =
  process.env.COVERAGE_OUTPUT_DIR ||
  path.join(process.cwd(), "coverage", "e2e-raw");

export const COVERAGE_REPORT_DIR =
  process.env.COVERAGE_REPORT_DIR ||
  path.join(process.cwd(), "coverage", "e2e");
