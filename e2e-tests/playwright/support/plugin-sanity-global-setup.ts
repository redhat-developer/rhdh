import { existsSync } from "fs";
import { resolve } from "path";

import { requireDynamicPluginsPopulated } from "./local-harness-global-setup";

const POPULATE_COMMAND =
  "CATALOG_INDEX_IMAGE=quay.io/rhdh/plugin-catalog-index:next ./e2e-tests/local-harness/populate-catalog-index.sh";

/**
 * globalSetup for playwright.plugin-sanity.config.ts.
 *
 * A leftover dynamic-plugins-root from the curated `populate.sh` satisfies the
 * shared plugin-count guard and would let the check pass green while validating
 * ~10 curated plugins instead of the whole index, so the breadcrumb that
 * populate-catalog-index.sh writes is required too.
 */
export default function pluginSanityGlobalSetup(): void {
  requireDynamicPluginsPopulated("plugin-sanity", POPULATE_COMMAND);

  const refs = resolve(process.cwd(), "..", "dynamic-plugins-root", ".catalog-index-refs");
  if (!existsSync(refs)) {
    throw new Error(
      `dynamic-plugins-root was not populated from the catalog index ` +
        `(${refs} is missing).\n\nRe-populate it with:\n\n  ${POPULATE_COMMAND}\n`,
    );
  }
}
