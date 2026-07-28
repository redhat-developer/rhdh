import { readCatalogIndexExpectation } from "../utils/plugin-loader";
import { requireDynamicPluginsPopulated } from "./local-harness-global-setup";
import { dynamicPluginsRoot } from "./local-harness-servers";

// The default index tracks main; a release branch carries its own version tag,
// so honour CATALOG_INDEX_IMAGE when the caller already set one.
const populateCommand = (): string => {
  const image = process.env.CATALOG_INDEX_IMAGE;
  const ref =
    image === undefined || image === "" ? "quay.io/rhdh/plugin-catalog-index:next" : image;
  return `CATALOG_INDEX_IMAGE=${ref} ./e2e-tests/local-harness/populate-catalog-index.sh`;
};

/**
 * globalSetup for playwright.plugin-sanity.config.ts.
 *
 * A leftover dynamic-plugins-root from the curated `populate.sh` satisfies the
 * shared plugin-count guard and would let the check pass green while validating
 * ~10 curated plugins instead of the whole index, so the breadcrumb that
 * populate-catalog-index.sh writes is required too.
 */
export default function pluginSanityGlobalSetup(): void {
  requireDynamicPluginsPopulated("e2e:plugin-sanity", populateCommand());

  if (readCatalogIndexExpectation(dynamicPluginsRoot) === null) {
    throw new Error(
      `dynamic-plugins-root was not populated from the catalog index ` +
        `(${dynamicPluginsRoot}/.catalog-index-refs is missing).\n\n` +
        `Re-populate it with:\n\n  ${populateCommand()}\n`,
    );
  }
}
