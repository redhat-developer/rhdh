import { createApp } from '@backstage/frontend-defaults';
import appVisualizerPlugin from '@backstage/plugin-app-visualizer';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import scaffolderPlugin from '@backstage/plugin-scaffolder/alpha';
import searchPlugin from '@backstage/plugin-search/alpha';
import userSettingsPlugin from '@backstage/plugin-user-settings/alpha';
import { dynamicFrontendFeaturesLoader } from '@backstage/frontend-dynamic-feature-loader';
import { appDrawerModule } from '@red-hat-developer-hub/backstage-plugin-app-react/alpha';
import globalHeaderPlugin, {
  globalHeaderModule,
  globalHeaderTranslationsModule,
} from '@red-hat-developer-hub/backstage-plugin-global-header/alpha';
import { rhdhThemeModule } from '@red-hat-developer-hub/backstage-plugin-theme/alpha';
import {
  homePageModule,
  homepageTranslationsModule,
} from '@red-hat-developer-hub/backstage-plugin-homepage/alpha';
import quickstartPlugin, {
  quickstartInitModule,
  quickstartTranslationsModule,
} from '@red-hat-developer-hub/backstage-plugin-quickstart/alpha';
import homePlugin from '@backstage/plugin-home/alpha';
import { navModule } from './modules/nav';
import { quickstartHelpModule } from './modules/quickstartHelp';
import { signInModule } from './modules/signIn';

const app = createApp({
  features: [
    rhdhThemeModule,
    navModule,
    signInModule,
    homePlugin,
    homePageModule,
    homepageTranslationsModule,
    appVisualizerPlugin,
    catalogPlugin,
    scaffolderPlugin,
    searchPlugin,
    userSettingsPlugin,
    appDrawerModule,
    dynamicFrontendFeaturesLoader(),
    // Static global-header must load after MF remotes so it wins plugin deduplication.
    globalHeaderModule,
    globalHeaderPlugin,
    globalHeaderTranslationsModule,
    quickstartHelpModule,
    quickstartPlugin,
    quickstartInitModule,
    quickstartTranslationsModule,
  ],
});

export default app.createRoot();
