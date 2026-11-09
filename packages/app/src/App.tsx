import type { IconElement } from "@backstage/frontend-plugin-api";
import { createApp } from "@backstage/frontend-defaults";
import { dynamicFrontendFeaturesLoader } from "@backstage/frontend-dynamic-feature-loader";
import catalogImportBase from "@backstage/plugin-catalog-import/alpha";
import catalogUnprocessedEntitiesPlugin from "@backstage/plugin-catalog-unprocessed-entities/alpha";
import homePagePlugin from "@backstage/plugin-home/alpha";

import rhdhThemeModule from "@red-hat-developer-hub/backstage-plugin-theme";
import translationsApiModule from "@red-hat-developer-hub/backstage-plugin-translations/translations-api-module";

import { customCatalogFilterModule } from "./modules/catalog";
import { scaffolderSelfServiceModule } from "./modules/scaffolder";
import { userSettingsGeneralModule } from "./modules/user-settings";
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
    customCatalogFilterModule, // Custom OR-logic tag filter
    // Note: @backstage/plugin-scaffolder is decoupled and NOT included in the core app bundle.
    // It is loaded dynamically as an OCI plugin. scaffolderSelfServiceModule only sets
    // the default RHDH page title and sidebar item to "Self-service" (RHDHBUGS-3676).
    scaffolderSelfServiceModule,
    // Note: @backstage/plugin-user-settings is decoupled and NOT included in the core app bundle.
    // It is loaded dynamically as an OCI plugin. userSettingsGeneralModule only customizes
    // the General sub-page extension layout to render the RHDH build-metadata InfoCard.
    userSettingsGeneralModule,
    dynamicFrontendFeaturesLoader(),
    // RHDH modules (local to app)
    translationsApiModule,
    rhdhTranslationsModule, // RHDH + plugin translation overrides (de, es, fr, it, ja)
    rhdhThemeModule, // RHDH light/dark themes
  ],
});

export default app.createRoot();
