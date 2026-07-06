import { readdirSync } from "fs";
import { resolve } from "path";

import type { FullConfig } from "@playwright/test";

/**
 * globalSetup for the cluster-free legacy harness (playwright.legacy-local.config.ts).
 *
 * Fails fast with an actionable message when `dynamic-plugins-root` has not been
 * populated — otherwise the legacy app boots with no plugins and specs fail with a
 * confusing locator timeout instead of a clear "populate first" error.
 */
export default function requireDynamicPluginsPopulated(_config: FullConfig): void {
  // process.cwd() is e2e-tests when Playwright runs; the plugins root is at repo root.
  const root = resolve(process.cwd(), "..", "dynamic-plugins-root");

  // Plugins are installed as one directory each; count only directories so the
  // installer's generated global-config file (written into the same root even when
  // zero plugins install) does not satisfy the guard.
  let pluginCount = 0;
  try {
    pluginCount = readdirSync(root, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    ).length;
  } catch {
    // root missing — treated as empty below.
  }

  if (pluginCount === 0) {
    throw new Error(
      `dynamic-plugins-root has no plugins — populate it before running e2e:legacy-local:\n\n` +
        `  ./e2e-tests/local-harness/populate.sh\n\n` +
        `See docs/e2e-tests/local-e2e-harness.md.`,
    );
  }
}
