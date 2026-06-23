import { readdirSync } from "fs";
import { resolve } from "path";

/**
 * globalSetup for the cluster-free legacy harness (playwright.legacy-local.config.ts).
 *
 * Fails fast with an actionable message when `dynamic-plugins-root` has not been
 * populated — otherwise the legacy app boots with no plugins and specs fail with a
 * confusing locator timeout instead of a clear "populate first" error.
 */
export default function requireDynamicPluginsPopulated(): void {
  // process.cwd() is e2e-tests when Playwright runs; the plugins root is at repo root.
  const root = resolve(process.cwd(), "..", "dynamic-plugins-root");

  let pluginCount = 0;
  try {
    pluginCount = readdirSync(root).filter(
      (entry) => entry !== ".gitkeep",
    ).length;
  } catch {
    // root missing — treated as empty below.
  }

  if (pluginCount === 0) {
    throw new Error(
      `dynamic-plugins-root is empty — populate it before running e2e:legacy-local:\n\n` +
        `  CATALOG_INDEX_IMAGE=quay.io/rhdh/plugin-catalog-index:latest \\\n` +
        `    npx @red-hat-developer-hub/cli-module-install-dynamic-plugins install dynamic-plugins-root\n\n` +
        `See docs/e2e-tests/local-e2e-harness.md.`,
    );
  }
}
