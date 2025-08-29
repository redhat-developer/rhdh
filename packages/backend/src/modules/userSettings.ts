import {
  coreServices,
  createBackendFeatureLoader,
} from '@backstage/backend-plugin-api';

export const userSettingsBackend = createBackendFeatureLoader({
  deps: {
    config: coreServices.rootConfig,
  },
  async loader({ config }) {
    const persistence =
      config.getOptionalString('userSettings.persistence') ?? 'database'; // default to database

    if (persistence !== 'database' && persistence !== 'browser') {
      throw new Error(
        `Invalid config value for 'userSettings.persistence': "${persistence}". Must be either "database" or "browser".`,
      );
    }
    if (persistence === 'database') {
      return [import('@backstage/plugin-user-settings-backend')];
    }
    // Opt-out: browser -> no backend feature
    return [];
  },
});
