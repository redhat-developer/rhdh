// Jira: RHIDP-13242 — Map E2E coverage onto the files Codecov knows about
//
// The deployed RHDH serves packages/app as minified bundles under /static/,
// each with a source map whose sources read `webpack://app/./src/...`.
// monocart unpacks those into `app/src/...` and, left unfiltered, also emits
// every bundled node_modules file and the webpack runtime: a first page load
// reports ~3,300 files, 17 of them in this repository. Codecov drops paths it
// cannot find in the repo, so the upload has to name repository paths exactly.

import type { CoverageReportOptions } from "monocart-coverage-reports";

// What monocart produces for a packages/app source once the source map is applied.
const APP_SOURCE_PREFIX = "app/src/";
// Where those files live in this repository.
const REPO_APP_SOURCE_PREFIX = "packages/app/src/";

/** Keep only the app's own bundles; dynamic plugins are served elsewhere and covered by RHIDP-11866. */
export function isAppBundle(entry: { url: string }): boolean {
  try {
    return new URL(entry.url).pathname.startsWith("/static/");
  } catch {
    return false;
  }
}

/** Rewrite `app/src/X` to the repository path `packages/app/src/X`. */
export function toRepoPath(sourcePath: string): string {
  return sourcePath.startsWith(APP_SOURCE_PREFIX)
    ? REPO_APP_SOURCE_PREFIX + sourcePath.slice(APP_SOURCE_PREFIX.length)
    : sourcePath;
}

/**
 * Keep only packages/app sources, dropping node_modules, webpack runtime and inlined JSON.
 *
 * monocart applies `sourcePath` before `sourceFilter`, so this sees the
 * rewritten path; normalising first keeps it correct whichever form arrives.
 */
export function isAppSource(sourcePath: string): boolean {
  return toRepoPath(sourcePath).startsWith(REPO_APP_SOURCE_PREFIX);
}

// Bundles are already narrowed to the app's own by SourceMapLoader (source-maps.ts).
export const coverageSourceOptions: Pick<
  CoverageReportOptions,
  "sourceFilter" | "sourcePath"
> = {
  sourceFilter: isAppSource,
  sourcePath: toRepoPath,
};
