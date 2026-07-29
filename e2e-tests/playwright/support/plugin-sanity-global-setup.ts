import {
  catalogIndexPopulateCommand,
  requireCatalogIndexExpectation,
} from "../utils/plugin-loader";
import { requireDynamicPluginsPopulated } from "./local-harness-global-setup";
import { dynamicPluginsRoot } from "./local-harness-servers";

/**
 * globalSetup for playwright.plugin-sanity.config.ts.
 *
 * A leftover dynamic-plugins-root from the curated `populate.sh` satisfies the
 * shared plugin-count guard and would let the check pass green while validating
 * ~10 curated plugins instead of the whole index, so the breadcrumb that
 * populate-catalog-index.sh writes is required too.
 */
export default function pluginSanityGlobalSetup(): void {
  requireDynamicPluginsPopulated("e2e:plugin-sanity", catalogIndexPopulateCommand());
  requireCatalogIndexExpectation(dynamicPluginsRoot);
}
