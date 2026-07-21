import { readdirSync } from "fs";
import { resolve } from "path";

/**
 * Shared guard for the cluster-free harnesses.
 *
 * Fails fast with an actionable message when `dynamic-plugins-root` has not been
 * populated — otherwise the app boots with no plugins and specs fail with a
 * confusing locator timeout instead of a clear "populate first" error.
 *
 * Each harness passes its OWN populate command: the two harnesses use different
 * scripts (and the plugin-sanity one needs CATALOG_INDEX_IMAGE), so a single
 * hard-coded hint would send half the callers to the wrong script.
 */
export function requireDynamicPluginsPopulated(runCommand: string, populateCommand: string): void {
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
      `dynamic-plugins-root has no plugins — populate it before running ${runCommand}:\n\n` +
        `  ${populateCommand}\n\n` +
        `See docs/e2e-tests/local-e2e-harness.md.`,
    );
  }
}

/** globalSetup for playwright.legacy-local.config.ts. */
export default function legacyLocalGlobalSetup(): void {
  requireDynamicPluginsPopulated("e2e:legacy-local", "./e2e-tests/local-harness/populate.sh");
}
