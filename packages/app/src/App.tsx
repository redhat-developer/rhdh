import type { IconElement } from "@backstage/frontend-plugin-api";
import { createApp } from "@backstage/frontend-defaults";
import { dynamicFrontendFeaturesLoader } from "@backstage/frontend-dynamic-feature-loader";
import catalogImportBase from "@backstage/plugin-catalog-import/alpha";
import catalogUnprocessedEntitiesPlugin from "@backstage/plugin-catalog-unprocessed-entities/alpha";
import homePagePlugin from "@backstage/plugin-home/alpha";

import rhdhThemeModule from "@red-hat-developer-hub/backstage-plugin-theme";
import translationsApiModule from "@red-hat-developer-hub/backstage-plugin-translations/translations-api-module";

import { rhdhCatalogGraphPlugin } from "./apis/apisModule";
import { rhdhTranslationsModule } from "./translations/translationsModule";
import { addRuntimeSharedDependencies } from "./enhancedSharing";

// Keep the /catalog-import route for scaffolder, but hide it from the sidebar.
const catalogImportPlugin = catalogImportBase.withOverrides({
  title: "",
  icon: false as unknown as IconElement,
});

// Avoid shipping duplicate copies of common libraries inside every dynamic plugin.
addRuntimeSharedDependencies();

const app = createApp({
  features: [
    // Upstream Backstage plugins
    homePagePlugin,
    catalogImportPlugin, // /catalog-import page; binds scaffolder.registerComponent (Import Git button)
    catalogUnprocessedEntitiesPlugin,
    rhdhCatalogGraphPlugin, // catalog-graph UI + scaffolderOf/scaffoldedFrom API override
    dynamicFrontendFeaturesLoader(),
    // RHDH modules (local to app)
    translationsApiModule,
    rhdhTranslationsModule, // RHDH + plugin translation overrides (de, es, fr, it, ja)
    rhdhThemeModule, // RHDH light/dark themes
  ],
});

export default app.createRoot();
