import { readdirSync } from "fs";

import { dynamicPluginsRoot } from "./local-harness-servers";

/**
 * Shared guard for the cluster-free NFS harness (playwright.local.config.ts).
 *
 * Fails fast with an actionable message when `dynamic-plugins-root` has not been
 * populated — otherwise the app boots with no plugins and specs fail with a
 * confusing locator timeout instead of a clear "populate first" error.
 */
export function requireDynamicPluginsPopulated(yarnScript: string, populateCommand: string): void {
  // Plugins are installed as one directory each; count only directories so the
  // installer's generated global-config file (written into the same root even when
  // zero plugins install) does not satisfy the guard.
  let pluginCount = 0;
  try {
    pluginCount = readdirSync(dynamicPluginsRoot, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    ).length;
  } catch {
    // root missing — treated as empty below.
  }

  if (pluginCount === 0) {
    throw new Error(
      `dynamic-plugins-root has no plugins — populate it before running ${yarnScript}:\n\n` +
        `  ${populateCommand}\n\n` +
        `See docs/e2e-tests/local-e2e-harness.md.`,
    );
  }
}

/** globalSetup for playwright.local.config.ts (NFS cluster-free harness). */
export default function nfsLocalGlobalSetup(): void {
  requireDynamicPluginsPopulated("e2e:local", "./e2e-tests/local-harness/populate.sh");
}
