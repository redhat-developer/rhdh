/**
 * Historical GitHub happy-path coverage retained outside the default E2E suite.
 *
 * RHDHBUGS-2099 blocks the flow today, so this file intentionally does not use
 * the `*.spec.ts` suffix and will not be picked up by Playwright discovery.
 * Restore it as an executable spec once the underlying catalog/entity issues are
 * fixed and the flow can be made deterministic again.
 */

export const GITHUB_HAPPY_PATH_BLOCKER = "RHDHBUGS-2099";
