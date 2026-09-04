import { createApp } from "@backstage/frontend-defaults";
import { dynamicFrontendFeaturesLoader } from "@backstage/frontend-dynamic-feature-loader";
import catalogPlugin from "@backstage/plugin-catalog/alpha";
import catalogImportPlugin from "@backstage/plugin-catalog-import/alpha";
import catalogUnprocessedEntitiesPlugin from "@backstage/plugin-catalog-unprocessed-entities/alpha";
import scaffolderPlugin from "@backstage/plugin-scaffolder/alpha";
import searchPlugin from "@backstage/plugin-search/alpha";
import userSettingsPlugin from "@backstage/plugin-user-settings/alpha";
import homePagePlugin from "@backstage/plugin-home/alpha";

import { rhdhThemeModule } from "@red-hat-developer-hub/backstage-plugin-theme/alpha";

import { rhdhApisModule, rhdhCatalogGraphPlugin } from "./apis/apisModule";
import { catalogCreatedAtModule } from "./modules/catalog";
import { learningPathsModule } from "./modules/learning-paths";
import { navModule } from "./modules/nav";
import { userSettingsGeneralModule } from "./modules/user-settings";
import { rhdhTranslationsModule } from "./translations/translationsModule";

const app = createApp({
  features: [
    // Upstream Backstage plugins
    homePagePlugin,
    catalogPlugin,
    catalogCreatedAtModule, // Created At column on catalog index
    catalogImportPlugin, // /catalog-import page; binds scaffolder.registerComponent (Import Git button)
    catalogUnprocessedEntitiesPlugin,
    rhdhCatalogGraphPlugin, // catalog-graph UI + scaffolderOf/scaffoldedFrom API override
    scaffolderPlugin,
    searchPlugin,
    userSettingsPlugin,
    dynamicFrontendFeaturesLoader(),
    // RHDH modules (local to app)
    navModule, // RHDH-branded sidebar (logo, menu ordering, drawer toggle)
    userSettingsGeneralModule, // build-metadata InfoCard on Settings / General
    learningPathsModule, // Learning Paths page (/learning-paths)
    rhdhApisModule, // storage, learning-path APIs
    rhdhTranslationsModule, // RHDH + plugin translation overrides (de, es, fr, it, ja)
    rhdhThemeModule, // RHDH light/dark themes
  ],
});

export default app.createRoot();
