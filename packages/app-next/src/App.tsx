import { createApp } from '@backstage/frontend-defaults';
import appVisualizerPlugin from '@backstage/plugin-app-visualizer';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import homePlugin from '@backstage/plugin-home/alpha';
import scaffolderPlugin from '@backstage/plugin-scaffolder/alpha';
import searchPlugin from '@backstage/plugin-search/alpha';
import userSettingsPlugin from '@backstage/plugin-user-settings/alpha';
import { navModule } from './modules/nav';
import { rhdhDynamicFrontendFeaturesLoader } from './modules/dynamicFeatures/rhdhDynamicFrontendFeaturesLoader';

// Keep the shell minimal: core Backstage plugins that still need to ship with
// the app (scaffolder-backend is not yet a dynamic plugin), plus the dynamic
// feature loader. Prefer RHDH UX from dynamic-plugins-root — see
// dynamic-plugins.example.yaml (app-auth, app-defaults, homepage, theme,
// global-header, quickstart, …).
//
// Use rhdhDynamicFrontendFeaturesLoader (not the stock loader) so named
// FrontendFeature exports such as globalHeaderModule / notifications-home-module
// are registered too.
//
// Homepage host: keep `@backstage/plugin-home` until rhdh-plugins#4032 lands
// (homePagePlugin as alpha default embeds the home plugin). RHDH layout/widgets
// and the app drawer come from OCI (homepage + app-defaults), not npm deps.
const app = createApp({
  features: [
    navModule,
    appVisualizerPlugin,
    catalogPlugin,
    homePlugin,
    scaffolderPlugin,
    searchPlugin,
    userSettingsPlugin,
    rhdhDynamicFrontendFeaturesLoader(),
  ],
});

export default app.createRoot();
