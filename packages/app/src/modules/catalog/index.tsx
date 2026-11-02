import { createFrontendModule } from "@backstage/frontend-plugin-api";
import { CatalogFilterBlueprint } from "@backstage/plugin-catalog-react/alpha";

import { CustomEntityTagPicker } from "./CustomEntityTagPicker";

/**
 * Custom tag filter with OR logic for catalog entity filtering.
 * Overrides the default `catalog-filter:catalog/tag` extension.
 */
const customTagFilter = CatalogFilterBlueprint.make({
  name: "tag",
  params: {
    loader: async () => <CustomEntityTagPicker />,
  },
});

export const customCatalogFilterModule = createFrontendModule({
  pluginId: "catalog",
  extensions: [customTagFilter],
});
