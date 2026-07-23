import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import {
  CLOUD_SQL_PROXY_CONTAINER,
  CLOUD_SQL_PROXY_IMAGE,
  CLOUD_SQL_SA_SECRET,
  CLOUD_SQL_VOLUME,
  buildCloudSqlProxySidecar,
  buildCloudSqlProxyVolume,
  generateCloudSqlHelmValuesOverlay,
} from "../playwright/utils/cloudsql-config";
import { isRecord } from "../playwright/utils/kube-client/helpers";

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${label}: expected object`);
  }
  return value;
}

describe("cloudsql-config", () => {
  // Synthetic connection name for unit assertions only — runtime uses CLOUDSQL_INSTANCE_*.
  const instanceConnectionName = "test-project:test-region:test-instance";

  it("builds Auth Proxy as a native sidecar initContainer with startupProbe", () => {
    const { container, volume } = buildCloudSqlProxySidecar(instanceConnectionName);
    expect(container.name).toBe(CLOUD_SQL_PROXY_CONTAINER);
    expect(container.image).toBe(CLOUD_SQL_PROXY_IMAGE);
    expect(container.restartPolicy).toBe("Always");
    expect(container.args).toEqual([
      "--structured-logs",
      "--credentials-file=/secrets/service_account.json",
      instanceConnectionName,
    ]);
    expect(isRecord(container.startupProbe)).toBe(true);
    expect(volume).toEqual(buildCloudSqlProxyVolume());
    expect(volume).toEqual({
      name: CLOUD_SQL_VOLUME,
      secret: { secretName: CLOUD_SQL_SA_SECRET },
    });
  });

  it("generates Helm overlay that disables local Postgres without replacing initContainers", () => {
    const overlay = requireRecord(parseYaml(generateCloudSqlHelmValuesOverlay()), "overlay");
    const upstream = requireRecord(overlay.upstream, "upstream");
    const backstage = requireRecord(upstream.backstage, "backstage");
    const postgresql = requireRecord(upstream.postgresql, "postgresql");

    expect(postgresql.enabled).toBe(false);
    expect(backstage.extraEnvVarsSecrets).toEqual(expect.arrayContaining(["postgres-cred"]));
    // Proxy is patched onto the Deployment as initContainer — do not override chart initContainers.
    expect(backstage.initContainers).toBeUndefined();
    expect(backstage.extraContainers).toBeUndefined();

    if (!Array.isArray(backstage.extraVolumes)) {
      throw new TypeError("Cloud SQL Helm overlay missing extraVolumes");
    }
    expect(
      backstage.extraVolumes.some(
        (volume: unknown) => isRecord(volume) && volume.name === CLOUD_SQL_VOLUME,
      ),
    ).toBe(true);
  });
});
