/** Label selectors for the operator-managed Backstage Deployment / pods. */

const BACKSTAGE_NAME_LABEL = {
  "app.kubernetes.io/name": "backstage",
} as const;

export function buildDeploymentLabelSelector(instanceName: string): string {
  const labels = {
    ...BACKSTAGE_NAME_LABEL,
    "app.kubernetes.io/instance": instanceName,
  };
  return labelSelectorFromMatchLabels(labels);
}

export function labelSelectorFromMatchLabels(matchLabels: Record<string, string>): string {
  return Object.entries(matchLabels)
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}
