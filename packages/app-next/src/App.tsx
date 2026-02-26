import { createApp } from '@backstage/frontend-defaults';
import { dynamicFrontendFeaturesLoader } from '@backstage/frontend-dynamic-feature-loader';
import appPlugin from '@backstage/plugin-app';
import appVisualizerPlugin from '@backstage/plugin-app-visualizer';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import homePlugin from '@backstage/plugin-home/alpha';
import scaffolderPlugin from '@backstage/plugin-scaffolder/alpha';
import searchPlugin from '@backstage/plugin-search/alpha';
import userSettingsPlugin from '@backstage/plugin-user-settings/alpha';

import { rhdhAuthApisModule } from './api/authApis';
import { SignInPage } from './components/SignInPage/SignInPage';

// Override default sign-in page with RHDH implementation (copy from packages/app).
// Auth API refs in api/ must stay aligned with backend.
const appWithSignInOverride = appPlugin.withOverrides({
  extensions: [
    appPlugin.getExtension('sign-in-page:app').override({
      params: {
        loader: async () => (props: Parameters<typeof SignInPage>[0]) => (
          <SignInPage {...props} />
        ),
      },
    }),
  ],
});

const app = createApp({
  features: [
    appWithSignInOverride,
    rhdhAuthApisModule,
    appVisualizerPlugin,
    catalogPlugin,
    scaffolderPlugin,
    searchPlugin,
    homePlugin,
    userSettingsPlugin,
    dynamicFrontendFeaturesLoader(),
  ],
});

export default app.createRoot();
