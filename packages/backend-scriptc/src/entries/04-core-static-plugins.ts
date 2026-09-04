/**
 * PROTOTYPE ladder rung — core static plugins, still no dynamicPluginsFeatureLoader.
 */
import { createBackend } from '@backstage/backend-defaults';
import { healthCheckPlugin } from '../../../backend/src/modules/healthcheck';

const backend = createBackend();
backend.add(healthCheckPlugin);
backend.add(import('@backstage/plugin-app-backend'));
backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(import('@backstage/plugin-proxy-backend'));
backend.add(import('@backstage/plugin-auth-backend'));
backend.add(import('@backstage/plugin-auth-backend-module-guest-provider'));
backend.add(import('@backstage/plugin-search-backend'));
backend.add(import('@backstage/plugin-search-backend-module-catalog'));
backend.add(import('@backstage/plugin-permission-backend'));
backend.start();
