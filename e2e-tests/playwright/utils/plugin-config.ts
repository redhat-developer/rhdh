/**
 * Plugin Configuration
 *
 * - Known plugin failures (environmental constraints)
 * - Config overrides for plugins that validate config at startup
 */

import type { JsonObject } from "@backstage/types";
import type { LoadedPlugin } from "./plugin-types";

/**
 * Known plugin failures due to environmental constraints
 *
 * These plugins are skipped during testing because they cannot load in the test environment.
 * Each entry includes the reason for exclusion to help determine if it can be re-enabled later.
 */
export const KNOWN_FAILURES = new Set<string>([
  // Module resolution issue with @pagerduty/backstage-plugin-backend/package.json
  "pagerduty-backstage-plugin-backend",

  // Conflicts with backstage-community argocd (both register pluginId 'argocd')
  "roadiehq-backstage-plugin-argo-cd-backend",

  // Orchestrator plugins require @backstage-community/plugin-rbac-common peer dep
  "red-hat-developer-hub-backstage-plugin-orchestrator-backend",
  "red-hat-developer-hub-backstage-plugin-orchestrator-backend-module-loki",
  "red-hat-developer-hub-backstage-plugin-scaffolder-backend-module-orchestrator",
]);

/**
 * Minimal config overrides for plugins that validate config at startup
 */
const configOverrides: Record<string, JsonObject> = {
  "backstage-community-plugin-jenkins-backend": {
    jenkins: {
      baseUrl: "http://localhost:8080",
      username: "test",
      apiKey: "test",
    },
  },
  "backstage-community-plugin-quay-backend": {
    quay: {
      uiUrl: "https://quay.io",
      apiUrl: "https://quay.io/api/v1",
    },
  },
  "immobiliarelabs-backstage-plugin-gitlab-backend": {
    integrations: {
      gitlab: [{ host: "gitlab.com", token: "test" }],
    },
  },
};

/**
 * Build merged config for plugins that require specific config at startup
 */
export function buildMergedConfig(plugins: LoadedPlugin[]): JsonObject {
  const merged: Record<string, unknown> = {};

  for (const { plugin } of plugins) {
    const overrides = configOverrides[plugin.dirName];
    if (overrides) {
      Object.assign(merged, overrides);
    }
  }

  return merged as JsonObject;
}
