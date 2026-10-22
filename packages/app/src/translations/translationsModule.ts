import { createFrontendModule } from "@backstage/frontend-plugin-api";
import { TranslationBlueprint } from "@backstage/plugin-app-react";

import { catalogImportTranslations } from "./catalog-import/catalog-import";
import { coreComponentsTranslations } from "./core-components/core-components";
import { rhdhTranslations } from "./rhdh";
import { userSettingsTranslations } from "./user-settings/user-settings";

/**
 * RHDH core translations (`rhdhTranslationRef`, id `rhdh`) plus overrides for
 * the catalog-import, core-components, user-settings plugin translation
 * resources — ported from the legacy OFS frontend translations. Locales:
 * de, es, fr, it, ja. Catalog, scaffolder and search overrides are provided by
 * their respective dynamic plugins once they are loaded dynamically.
 */
export const rhdhTranslationsModule = createFrontendModule({
  pluginId: "app",
  extensions: (
    [
      ["rhdh", rhdhTranslations],
      ["catalog-import", catalogImportTranslations],
      ["core-components", coreComponentsTranslations],
      ["user-settings", userSettingsTranslations],
    ] as const
  ).map(([name, resource]) =>
    TranslationBlueprint.make({
      name,
      params: { resource },
    }),
  ),
});
