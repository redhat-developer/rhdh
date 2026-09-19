/**
 * PROTOTYPE ladder rung — createBackend + RHDH healthcheck plugin (no dynamic plugins).
 */
import { createBackend } from '@backstage/backend-defaults';
import { healthCheckPlugin } from '../../../backend/src/modules/healthcheck';

const backend = createBackend();
backend.add(healthCheckPlugin);
backend.start();
