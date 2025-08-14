import { createBackendFeatureLoader } from '@backstage/backend-plugin-api';

import techdocsSearchModule from '@backstage/plugin-search-backend-module-techdocs/alpha';
import techdocsPlugin from '@backstage/plugin-techdocs-backend/alpha';

export const bundle = createBackendFeatureLoader({
  async loader() {
    return [techdocsPlugin, techdocsSearchModule];
  },
});