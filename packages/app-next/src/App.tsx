import { createApp } from '@backstage/frontend-defaults';
import appVisualizerPlugin from '@backstage/plugin-app-visualizer';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import homePlugin from '@backstage/plugin-home/alpha';
import scaffolderPlugin from '@backstage/plugin-scaffolder/alpha';
import searchPlugin from '@backstage/plugin-search/alpha';
import userSettingsPlugin from '@backstage/plugin-user-settings/alpha';
import { appDrawerModule } from '@red-hat-developer-hub/backstage-plugin-app-react/alpha';
import { homePageModule } from '@red-hat-developer-hub/backstage-plugin-homepage/alpha';
import { navModule } from './modules/nav';
import { rhdhDynamicFrontendFeaturesLoader } from './modules/dynamicFeatures/rhdhDynamicFrontendFeaturesLoader';

// Keep the shell minimal: core Backstage plugins that still need to ship with
// the app (scaffolder-backend is not yet a dynamic plugin), plus the dynamic
// feature loader. Prefer RHDH UX from dynamic-plugins-root — see
// dynamic-plugins.example.yaml (app-auth, global-header, quickstart, …).
//
// Use rhdhDynamicFrontendFeaturesLoader (not the stock loader) so named
// FrontendFeature exports such as globalHeaderModule / notifications-home-module
// are registered too.
//
// Homepage: `@backstage/plugin-home` is the NFS host (pluginId `home`) for
// RHDH layout and third-party cards (e.g. unread notifications). Keep
// homePageModule static until RHIDP-14519 promotes NFS to stable `.` and an
// NFS-capable OCI overlay exists (or use a local rhdh-plugins export — README).
const app = createApp({
  features: [
    navModule,
    appVisualizerPlugin,
    catalogPlugin,
    homePlugin,
    homePageModule,
    scaffolderPlugin,
    searchPlugin,
    userSettingsPlugin,
    appDrawerModule,
    rhdhDynamicFrontendFeaturesLoader(),
  ],
});

export default app.createRoot();
