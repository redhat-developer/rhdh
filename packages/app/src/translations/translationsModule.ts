import { createFrontendModule } from "@backstage/frontend-plugin-api";
import { TranslationBlueprint } from "@backstage/plugin-app-react";

import { catalogImportTranslations } from "./catalog-import/catalog-import";
import { coreComponentsTranslations } from "./core-components/core-components";
import { rhdhTranslations } from "./rhdh";

/**
 * RHDH core translations (`rhdhTranslationRef`, id `rhdh`) plus overrides for
 * the catalog-import, core-components plugin translation resources — ported from
 * the legacy OFS frontend translations. Locales: de, es, fr, it, ja. Catalog,
 * scaffolder, search and user-settings overrides are provided by their respective
 * dynamic plugins once they are loaded dynamically.
 */
export const rhdhTranslationsModule = createFrontendModule({
  pluginId: "app",
  extensions: (
    [
      ["rhdh", rhdhTranslations],
      ["catalog-import", catalogImportTranslations],
      ["core-components", coreComponentsTranslations],
    ] as const
  ).map(([name, resource]) =>
    TranslationBlueprint.make({
      name,
      params: { resource },
    }),
  ),
});
