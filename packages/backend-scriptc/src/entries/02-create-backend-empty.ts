/**
 * PROTOTYPE ladder rung — createBackend() only (no plugins, no dynamic loader).
 */
import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();
backend.start();
