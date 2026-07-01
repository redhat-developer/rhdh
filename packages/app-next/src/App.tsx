import { createApp } from '@backstage/frontend-defaults';
import { dynamicFrontendFeaturesLoader } from '@backstage/frontend-dynamic-feature-loader';

const app = createApp({
  features: [
    dynamicFrontendFeaturesLoader()
  ],
});

export default app.createRoot();
