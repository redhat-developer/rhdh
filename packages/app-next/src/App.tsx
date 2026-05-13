import { createApp } from '@backstage/frontend-defaults';
import appVisualizerPlugin from '@backstage/plugin-app-visualizer';
import authPlugin from '@backstage/plugin-auth';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import homePlugin from '@backstage/plugin-home/alpha';
import scaffolderPlugin from '@backstage/plugin-scaffolder/alpha';
import searchPlugin from '@backstage/plugin-search/alpha';
import userSettingsPlugin from '@backstage/plugin-user-settings/alpha';
import { dynamicFrontendFeaturesLoader } from '@backstage/frontend-dynamic-feature-loader';

const app = createApp({
  features: [
    appVisualizerPlugin,
    authPlugin,
    catalogPlugin,
    scaffolderPlugin,
    searchPlugin,
    homePlugin,
    userSettingsPlugin,
    dynamicFrontendFeaturesLoader()
  ],
});

export default app.createRoot();
