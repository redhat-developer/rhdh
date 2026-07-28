/**
 * Google Cloud SQL Auth Proxy helpers for showcase-runtime external DB tests.
 *
 * Installs the Auth Proxy as a native sidecar initContainer (`restartPolicy:
 * Always` + startupProbe) so the DB tunnel is up before backstage-backend
 * starts — matching RHIDP-7007 / RHIDP-12563.
 *
 * Helm (RHIDP-9140): values overlay + live Deployment JSON patch.
 * Operator (RHIDP-9141): merge proxy into Backstage CR `deployment.patch` so
 * reconcile does not wipe a Deployment-only edit.
 */

import { existsSync, readFileSync } from "fs";

import * as yaml from "yaml";

import { base64Encode, discoverRouterBase, resolveInstallMethod } from "./helper";
import { deploymentName as resolveDeploymentName } from "./instance-route-identity";
import { KubeClient, isRecord } from "./kube-client";
import { ensureRecord, type YamlRecord } from "./operator-install-profile";
import { generateHelmValuesYaml, resolveConfig, type BackstageCR } from "./runtime-config";
import {
  getRuntimeBackstageCr,
  replaceRuntimeBackstageCr,
  upgradeRuntimeHelmRelease,
} from "./runtime-deploy";

export const CLOUD_SQL_PROXY_IMAGE = "gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.21.3";
export const CLOUD_SQL_SA_SECRET = "cloud-sql-service-account";
export const CLOUD_SQL_PROXY_CONTAINER = "cloud-sql-proxy";
export const CLOUD_SQL_VOLUME = "cloud-sql-secret";

function asNamedRecordList(value: unknown): YamlRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is YamlRecord => isRecord(item));
}

function upsertNamedRecord(list: YamlRecord[], item: YamlRecord): YamlRecord[] {
  const name = item.name;
  if (typeof name !== "string" || name === "") {
    throw new Error("Named pod-spec item requires a string name");
  }
  return [...list.filter((entry) => entry.name !== name), item];
}

/** SA key volume mounted by the Auth Proxy sidecar. */
export function buildCloudSqlProxyVolume(): YamlRecord {
  return {
    name: CLOUD_SQL_VOLUME,
    secret: { secretName: CLOUD_SQL_SA_SECRET },
  };
}

/** Cloud SQL Auth Proxy native-sidecar initContainer + volume. */
export function buildCloudSqlProxySidecar(instanceConnectionName: string): {
  container: YamlRecord;
  volume: YamlRecord;
} {
  const container: YamlRecord = {
    name: CLOUD_SQL_PROXY_CONTAINER,
    image: CLOUD_SQL_PROXY_IMAGE,
    // Native sidecar: app containers wait until startupProbe succeeds.
    restartPolicy: "Always",
    args: [
      "--structured-logs",
      "--credentials-file=/secrets/service_account.json",
      instanceConnectionName,
    ],
    env: [
      { name: "CSQL_PROXY_PORT", value: "5432" },
      { name: "CSQL_PROXY_HEALTH_CHECK", value: "true" },
      { name: "CSQL_PROXY_HTTP_PORT", value: "9801" },
      { name: "CSQL_PROXY_HTTP_ADDRESS", value: "0.0.0.0" },
      { name: "CSQL_PROXY_EXIT_ZERO_ON_SIGTERM", value: "true" },
      { name: "CSQL_PROXY_QUITQUITQUIT", value: "true" },
      { name: "CSQL_PROXY_ADMIN_PORT", value: "9092" },
    ],
    lifecycle: {
      preStop: {
        exec: {
          command: ["/cloud-sql-proxy", "shutdown", "--admin-port", "9092"],
        },
      },
    },
    securityContext: {
      runAsNonRoot: true,
      readOnlyRootFilesystem: true,
      allowPrivilegeEscalation: false,
    },
    ports: [{ containerPort: 9801 }],
    startupProbe: {
      httpGet: { path: "/startup", port: 9801 },
      periodSeconds: 1,
      failureThreshold: 60,
    },
    livenessProbe: {
      httpGet: { path: "/liveness", port: 9801 },
      periodSeconds: 10,
      failureThreshold: 3,
    },
    resources: {
      requests: { memory: "2Gi", cpu: "1" },
    },
    volumeMounts: [
      {
        name: CLOUD_SQL_VOLUME,
        mountPath: "/secrets/",
        readOnly: true,
      },
    ],
  };

  return { container, volume: buildCloudSqlProxyVolume() };
}

/**
 * Create/update the GCP service account key secret used by the Auth Proxy.
 */
export async function createCloudSqlServiceAccountSecret(
  kubeClient: KubeClient,
  namespace: string,
  jsonPath: string,
): Promise<void> {
  if (!existsSync(jsonPath)) {
    throw new Error(`Cloud SQL service account JSON not found: ${jsonPath}`);
  }
  const content = readFileSync(jsonPath, "utf-8");
  await kubeClient.createOrUpdateSecret(
    {
      metadata: { name: CLOUD_SQL_SA_SECRET },
      data: {
        "service_account.json": base64Encode(content),
      },
    },
    namespace,
  );
  console.log(`Secret ${CLOUD_SQL_SA_SECRET} ready in ${namespace}`);
}

/**
 * Helm values overlay: disable local Postgres and wire postgres-cred + SA volume.
 * Proxy is applied separately as a native sidecar initContainer on the Deployment
 * so we do not replace the chart's install-dynamic-plugins initContainer list.
 *
 * Also overrides chart-default `POSTGRESQL_ADMIN_PASSWORD` / app-config password
 * placeholders: with `upstream.postgresql.enabled=false` the `<release>-postgresql`
 * Secret is not created, and leaving those refs causes CreateContainerConfigError.
 */
export function generateCloudSqlHelmValuesOverlay(): string {
  const parsed: unknown = yaml.parse(generateHelmValuesYaml());
  if (!isRecord(parsed)) {
    throw new TypeError("runtime Helm values: expected a YAML object");
  }
  const base = parsed;
  const upstream = ensureRecord(base, "upstream");
  const backstage = ensureRecord(upstream, "backstage");

  backstage.extraVolumes = upsertNamedRecord(
    asNamedRecordList(backstage.extraVolumes),
    buildCloudSqlProxyVolume(),
  );
  // Keep BACKEND_SECRET only — drop chart-default POSTGRESQL_ADMIN_PASSWORD.
  backstage.extraEnvVars = [
    {
      name: "BACKEND_SECRET",
      valueFrom: {
        secretKeyRef: {
          key: "backend-secret",
          name: '{{ include "rhdh.backend-secret-name" $ }}',
        },
      },
    },
  ];
  backstage.extraEnvVarsSecrets = ["postgres-cred"];

  const appConfig = ensureRecord(backstage, "appConfig");
  const backend = ensureRecord(appConfig, "backend");
  backend.database = {
    connection: {
      host: "${POSTGRES_HOST}",
      port: "${POSTGRES_PORT}",
      user: "${POSTGRES_USER}",
      password: "${POSTGRES_PASSWORD}",
    },
  };

  upstream.postgresql = { enabled: false };

  return yaml.stringify(base, { lineWidth: 0 });
}

/**
 * Upsert the Auth Proxy as a native sidecar initContainer on the live Deployment.
 * Ensures the proxy is ready before backstage-backend starts (K8s native sidecars).
 */
async function upsertCloudSqlProxyOnDeployment(
  kubeClient: KubeClient,
  namespace: string,
  deploymentName: string,
  instanceConnectionName: string,
): Promise<void> {
  const response = await kubeClient.appsApi.readNamespacedDeployment(deploymentName, namespace);
  const podSpec = response.body.spec?.template?.spec;
  if (podSpec === undefined) {
    throw new Error(`Deployment ${deploymentName} has no pod spec`);
  }

  const { container, volume } = buildCloudSqlProxySidecar(instanceConnectionName);
  const initContainers = upsertNamedRecord(asNamedRecordList(podSpec.initContainers), container);
  const volumes = upsertNamedRecord(asNamedRecordList(podSpec.volumes), volume);

  // JSON Patch replaces whole arrays so we keep chart initContainers and upsert the proxy.
  const patch: object[] = [
    {
      op: podSpec.initContainers === undefined ? "add" : "replace",
      path: "/spec/template/spec/initContainers",
      value: initContainers,
    },
    {
      op: podSpec.volumes === undefined ? "add" : "replace",
      path: "/spec/template/spec/volumes",
      value: volumes,
    },
  ];
  await kubeClient.jsonPatchDeployment(deploymentName, namespace, patch);
  console.log(
    `Deployment ${deploymentName}: Auth Proxy native sidecar → ${instanceConnectionName}`,
  );
}

/**
 * Merge Auth Proxy native sidecar + SA volume into a Backstage CR
 * `spec.deployment.patch` (preserves install-dynamic-plugins / image / volumes).
 */
export function mergeCloudSqlProxyIntoBackstageCr(
  cr: BackstageCR,
  instanceConnectionName: string,
): BackstageCR {
  const next: BackstageCR = structuredClone(cr);
  const deployment = ensureRecord(next.spec, "deployment");
  const patch = ensureRecord(deployment, "patch");
  const patchSpec = ensureRecord(patch, "spec");
  const template = ensureRecord(patchSpec, "template");
  const podSpec = ensureRecord(template, "spec");

  const { container, volume } = buildCloudSqlProxySidecar(instanceConnectionName);
  podSpec.initContainers = upsertNamedRecord(asNamedRecordList(podSpec.initContainers), container);
  podSpec.volumes = upsertNamedRecord(asNamedRecordList(podSpec.volumes), volume);

  // Keep postgres-cred wired at CR level (mirrors Helm extraEnvVarsSecrets).
  const application = ensureRecord(next.spec, "application");
  const extraEnvs = ensureRecord(application, "extraEnvs");
  const secrets = asNamedRecordList(extraEnvs.secrets);
  if (!secrets.some((secret) => secret.name === "postgres-cred")) {
    extraEnvs.secrets = [...secrets, { name: "postgres-cred" }];
  }

  return next;
}

async function injectCloudSqlSidecarHelm(
  kubeClient: KubeClient,
  namespace: string,
  releaseName: string,
  instanceConnectionName: string,
): Promise<void> {
  const deploymentName = resolveDeploymentName("helm", releaseName);
  const routerBase = process.env.K8S_CLUSTER_ROUTER_BASE ?? (await discoverRouterBase());
  const config = { ...resolveConfig(routerBase), releaseName, namespace };
  // Apply overlay without --wait: DB is only reachable after the proxy patch.
  await upgradeRuntimeHelmRelease(config, generateCloudSqlHelmValuesOverlay(), {
    wait: false,
  });
  await upsertCloudSqlProxyOnDeployment(
    kubeClient,
    namespace,
    deploymentName,
    instanceConnectionName,
  );
  await kubeClient.restartDeploymentWithRetry(deploymentName, namespace);
}

async function injectCloudSqlSidecarOperator(
  kubeClient: KubeClient,
  namespace: string,
  releaseName: string,
  instanceConnectionName: string,
): Promise<void> {
  const deploymentName = resolveDeploymentName("operator", releaseName);
  const cr = await getRuntimeBackstageCr(kubeClient, namespace, releaseName);
  const merged = mergeCloudSqlProxyIntoBackstageCr(cr, instanceConnectionName);
  await replaceRuntimeBackstageCr(kubeClient, namespace, releaseName, merged);
  console.log(`Backstage CR ${releaseName}: Auth Proxy native sidecar → ${instanceConnectionName}`);
  // Rollout: native sidecar startupProbe must pass before backstage-backend is Ready.
  await kubeClient.restartDeploymentWithRetry(deploymentName, namespace);
}

/**
 * Install/update the Auth Proxy native sidecar for Helm or Operator.
 * Helm: values overlay (no `--wait`) + Deployment initContainer patch, then restart.
 * Operator: merge proxy into Backstage CR deployment.patch, then restart.
 */
export async function injectCloudSqlSidecar(
  kubeClient: KubeClient,
  namespace: string,
  releaseName: string,
  instanceConnectionName: string,
): Promise<void> {
  const installMethod = resolveInstallMethod();
  if (installMethod === "helm") {
    await injectCloudSqlSidecarHelm(kubeClient, namespace, releaseName, instanceConnectionName);
    return;
  }
  if (installMethod === "operator") {
    await injectCloudSqlSidecarOperator(kubeClient, namespace, releaseName, instanceConnectionName);
    return;
  }
  throw new Error(
    `Cloud SQL Auth Proxy inject unsupported for install method "${String(installMethod)}"`,
  );
}

/**
 * Rotate the Auth Proxy target instance. Helm patches the live Deployment;
 * Operator updates the Backstage CR so reconcile keeps the sidecar.
 */
export async function configureCloudSqlProxyInstance(
  kubeClient: KubeClient,
  namespace: string,
  releaseName: string,
  instanceConnectionName: string,
): Promise<void> {
  const installMethod = resolveInstallMethod();
  const deploymentName = resolveDeploymentName(installMethod, releaseName);

  if (installMethod === "helm") {
    await upsertCloudSqlProxyOnDeployment(
      kubeClient,
      namespace,
      deploymentName,
      instanceConnectionName,
    );
  } else if (installMethod === "operator") {
    const cr = await getRuntimeBackstageCr(kubeClient, namespace, releaseName);
    const merged = mergeCloudSqlProxyIntoBackstageCr(cr, instanceConnectionName);
    await replaceRuntimeBackstageCr(kubeClient, namespace, releaseName, merged);
    console.log(
      `Backstage CR ${releaseName}: Auth Proxy native sidecar → ${instanceConnectionName}`,
    );
  } else {
    throw new Error(
      `Cloud SQL Auth Proxy configure unsupported for install method "${String(installMethod)}"`,
    );
  }

  await kubeClient.restartDeploymentWithRetry(deploymentName, namespace);
}
