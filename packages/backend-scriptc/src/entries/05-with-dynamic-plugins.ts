/**
 * PROTOTYPE ladder rung — adds dynamicPluginsFeatureLoader (the RHDH hard stop candidate).
 */
import { createBackend } from '@backstage/backend-defaults';
import {
  CommonJSModuleLoader,
  dynamicPluginsFeatureLoader,
} from '@backstage/backend-dynamic-feature-service';
import { PackageRoles } from '@backstage/cli-node';
import * as path from 'path';
import { healthCheckPlugin } from '../../../backend/src/modules/healthcheck';

const backend = createBackend();

backend.add(
  dynamicPluginsFeatureLoader({
    schemaLocator(pluginPackage) {
      const platform = PackageRoles.getRoleInfo(
        pluginPackage.manifest.backstage.role,
      ).platform;
      return path.join(
        platform === 'node' ? 'dist' : 'dist-scalprum',
        'configSchema.json',
      );
    },
    moduleLoader: logger =>
      new CommonJSModuleLoader({
        logger,
      }),
  }),
);

backend.add(healthCheckPlugin);
backend.add(import('@backstage/plugin-catalog-backend'));
backend.start();
