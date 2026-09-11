import type { IconElement } from '@backstage/frontend-plugin-api';
import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import catalogImportBase from '@backstage/plugin-catalog-import/alpha';
import scaffolderPlugin from '@backstage/plugin-scaffolder/alpha';
import searchPlugin from '@backstage/plugin-search/alpha';
import userSettingsPlugin from '@backstage/plugin-user-settings/alpha';
import { dynamicFrontendFeaturesLoader } from '@backstage/frontend-dynamic-feature-loader';

// Keep the /catalog-import route for scaffolder, but hide it from the sidebar.
const catalogImportPlugin = catalogImportBase.withOverrides({
  title: '',
  icon: false as unknown as IconElement,
});

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
