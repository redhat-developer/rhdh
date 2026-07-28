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
  mergeCloudSqlProxyIntoBackstageCr,
} from "../playwright/utils/cloudsql-config";
import { isRecord } from "../playwright/utils/kube-client/helpers";
import type { BackstageCR } from "../playwright/utils/runtime-config";

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
    const appConfig = requireRecord(backstage.appConfig, "appConfig");
    const backend = requireRecord(appConfig.backend, "backend");
    const database = requireRecord(backend.database, "database");
    const connection = requireRecord(database.connection, "connection");

    expect(postgresql.enabled).toBe(false);
    expect(backstage.extraEnvVarsSecrets).toEqual(expect.arrayContaining(["postgres-cred"]));
    // Proxy is patched onto the Deployment as initContainer — do not override chart initContainers.
    expect(backstage.initContainers).toBeUndefined();
    expect(backstage.extraContainers).toBeUndefined();

    if (!Array.isArray(backstage.extraEnvVars)) {
      throw new TypeError("Cloud SQL Helm overlay missing extraEnvVars");
    }
    const envNames = backstage.extraEnvVars.map((envVar: unknown) =>
      isRecord(envVar) ? envVar.name : undefined,
    );
    expect(envNames).toContain("BACKEND_SECRET");
    expect(envNames).not.toContain("POSTGRESQL_ADMIN_PASSWORD");

    expect(connection).toEqual({
      host: "${POSTGRES_HOST}",
      port: "${POSTGRES_PORT}",
      user: "${POSTGRES_USER}",
      password: "${POSTGRES_PASSWORD}",
    });

    if (!Array.isArray(backstage.extraVolumes)) {
      throw new TypeError("Cloud SQL Helm overlay missing extraVolumes");
    }
    expect(
      backstage.extraVolumes.some(
        (volume: unknown) => isRecord(volume) && volume.name === CLOUD_SQL_VOLUME,
      ),
    ).toBe(true);
  });

  it("merges Auth Proxy into Backstage CR deployment.patch without dropping chart initContainers", () => {
    const cr: BackstageCR = {
      kind: "Backstage",
      apiVersion: "rhdh.redhat.com/v1alpha5",
      metadata: { name: "rhdh" },
      spec: {
        deployment: {
          patch: {
            spec: {
              template: {
                spec: {
                  containers: [{ name: "backstage-backend", image: "quay.io/example/rhdh:test" }],
                  initContainers: [
                    { name: "install-dynamic-plugins", image: "quay.io/example/rhdh:test" },
                  ],
                  volumes: [{ name: "dynamic-plugins-root", emptyDir: {} }],
                },
              },
            },
          },
        },
        application: {
          extraEnvs: {
            secrets: [{ name: "rhdh-runtime-config" }],
          },
        },
      },
    };

    const merged = mergeCloudSqlProxyIntoBackstageCr(cr, instanceConnectionName);
    const deployment = requireRecord(merged.spec.deployment, "deployment");
    const patch = requireRecord(deployment.patch, "patch");
    const patchSpec = requireRecord(patch.spec, "spec");
    const template = requireRecord(patchSpec.template, "template");
    const podSpec = requireRecord(template.spec, "podSpec");

    if (!Array.isArray(podSpec.initContainers)) {
      throw new TypeError("expected initContainers array");
    }
    const initContainers: unknown[] = podSpec.initContainers;
    const initNames = initContainers.map((c) => (isRecord(c) ? c.name : undefined));
    expect(initNames).toEqual(
      expect.arrayContaining(["install-dynamic-plugins", CLOUD_SQL_PROXY_CONTAINER]),
    );

    const proxy: unknown = initContainers.find(
      (c) => isRecord(c) && c.name === CLOUD_SQL_PROXY_CONTAINER,
    );
    expect(isRecord(proxy)).toBe(true);
    if (!isRecord(proxy)) {
      throw new TypeError("proxy missing");
    }
    expect(proxy.args).toEqual([
      "--structured-logs",
      "--credentials-file=/secrets/service_account.json",
      instanceConnectionName,
    ]);
    expect(proxy.restartPolicy).toBe("Always");

    const volumes = podSpec.volumes;
    if (!Array.isArray(volumes)) {
      throw new TypeError("expected volumes array");
    }
    expect(volumes.some((volume) => isRecord(volume) && volume.name === CLOUD_SQL_VOLUME)).toBe(
      true,
    );
    expect(
      volumes.some((volume) => isRecord(volume) && volume.name === "dynamic-plugins-root"),
    ).toBe(true);

    const application = requireRecord(merged.spec.application, "application");
    const extraEnvs = requireRecord(application.extraEnvs, "extraEnvs");
    if (!Array.isArray(extraEnvs.secrets)) {
      throw new TypeError("expected extraEnvs.secrets array");
    }
    expect(extraEnvs.secrets.map((s) => (isRecord(s) ? s.name : undefined))).toEqual(
      expect.arrayContaining(["rhdh-runtime-config", "postgres-cred"]),
    );

    // Rotation updates proxy args without duplicating the sidecar.
    const rotatedName = "test-project:test-region:other-instance";
    const rotated = mergeCloudSqlProxyIntoBackstageCr(merged, rotatedName);
    const rotatedDeployment = requireRecord(rotated.spec.deployment, "deployment");
    const rotatedPatch = requireRecord(rotatedDeployment.patch, "patch");
    const rotatedPatchSpec = requireRecord(rotatedPatch.spec, "spec");
    const rotatedTemplate = requireRecord(rotatedPatchSpec.template, "template");
    const rotatedPod = requireRecord(rotatedTemplate.spec, "rotatedPod");
    if (!Array.isArray(rotatedPod.initContainers)) {
      throw new TypeError("expected rotated initContainers");
    }
    const rotatedInits: unknown[] = rotatedPod.initContainers;
    expect(
      rotatedInits.filter((c) => isRecord(c) && c.name === CLOUD_SQL_PROXY_CONTAINER),
    ).toHaveLength(1);
    const rotatedProxy: unknown = rotatedInits.find(
      (c) => isRecord(c) && c.name === CLOUD_SQL_PROXY_CONTAINER,
    );
    expect(isRecord(rotatedProxy) && rotatedProxy.args).toEqual([
      "--structured-logs",
      "--credentials-file=/secrets/service_account.json",
      rotatedName,
    ]);
  });
});
