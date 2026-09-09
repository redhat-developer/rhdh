import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import catalogImportPlugin from '@backstage/plugin-catalog-import/alpha';
import scaffolderPlugin from '@backstage/plugin-scaffolder/alpha';
import searchPlugin from '@backstage/plugin-search/alpha';
import userSettingsPlugin from '@backstage/plugin-user-settings/alpha';
import { dynamicFrontendFeaturesLoader } from '@backstage/frontend-dynamic-feature-loader';

const app = createApp({
  features: [
    catalogPlugin,
    catalogImportPlugin,
    scaffolderPlugin,
    searchPlugin,
    userSettingsPlugin,
    dynamicFrontendFeaturesLoader(),
  ],
});

export default app.createRoot();
