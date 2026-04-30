import type { JsonObject, JsonValue } from "@backstage/types";

// Plugins skipped due to environmental constraints
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

// NOTE: JsonObject requires explicit typing for nested structures.
// Using a typed helper avoids repeated `as unknown as JsonObject` casts.
function json(obj: Record<string, JsonValue>): JsonObject {
  return obj;
}

// Minimal config for plugins that validate config at startup
export const CONFIG_OVERRIDES: Record<string, JsonObject> = {
  "backstage-community-plugin-jenkins-backend": json({
    jenkins: json({ baseUrl: "http://localhost:8080", username: "test", apiKey: "test" }),
  }),
  "backstage-community-plugin-quay-backend": json({
    quay: json({ uiUrl: "https://quay.io", apiUrl: "https://quay.io/api/v1" }),
  }),
  "immobiliarelabs-backstage-plugin-gitlab-backend": json({
    integrations: json({ gitlab: [json({ host: "gitlab.com", token: "test" })] }),
  }),
  "roadiehq-backstage-plugin-argo-cd-backend": json({
    argocd: json({ appLocatorMethods: [json({ type: "config", instances: [] })] }),
  }),
};

export function buildMergedConfig(
  plugins: { plugin: { dirName: string } }[],
): JsonObject {
  const merged: Record<string, JsonValue> = {};
  for (const { plugin } of plugins) {
    const overrides = CONFIG_OVERRIDES[plugin.dirName];
    if (overrides) Object.assign(merged, overrides);
  }
  return json(merged);
}
