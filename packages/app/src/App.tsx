import { createApp } from '@backstage/frontend-defaults';
import { dynamicFrontendFeaturesLoader } from '@backstage/frontend-dynamic-feature-loader';
import appVisualizerPlugin from '@backstage/plugin-app-visualizer';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import scaffolderPlugin from '@backstage/plugin-scaffolder/alpha';
import searchPlugin from '@backstage/plugin-search/alpha';
import userSettingsPlugin from '@backstage/plugin-user-settings/alpha';

import { appAuthModule } from '@red-hat-developer-hub/backstage-plugin-app-auth/alpha';
import { appIntegrationsModule } from '@red-hat-developer-hub/backstage-plugin-app-integrations/alpha';
import { appDrawerModule } from '@red-hat-developer-hub/backstage-plugin-app-react/alpha';
import { rhdhThemeModule } from '@red-hat-developer-hub/backstage-plugin-theme/alpha';

import { rhdhApisModule } from './apis/apisModule';
import { navModule } from './modules/nav';
import { userSettingsGeneralModule } from './modules/user-settings';
import { rhdhTranslationsModule } from './translations/translationsModule';

const app = createApp({
  features: [
    // Upstream Backstage plugins
    appVisualizerPlugin,
    catalogPlugin,
    scaffolderPlugin,
    searchPlugin,
    userSettingsPlugin,
    dynamicFrontendFeaturesLoader(),
    // RHDH modules (from rhdh-plugins workspace)
    appAuthModule, // config-driven sign-in page + OIDC/Keycloak/PingFederate/Auth0/SAML auth APIs
    appIntegrationsModule, // SCM integrations + SCM auth APIs
    appDrawerModule, // drawer infrastructure (lightspeed, quickstarts, etc.)
    // RHDH modules (local to app)
    navModule, // RHDH-branded sidebar (logo, menu ordering, drawer toggle)
    userSettingsGeneralModule, // build-metadata InfoCard on Settings / General
    rhdhApisModule, // storage, learning-path, catalog-graph APIs
    rhdhTranslationsModule, // RHDH + plugin translation overrides (de, es, fr, it, ja)
    rhdhThemeModule, // RHDH light/dark themes
  ],
});

export default app.createRoot();
