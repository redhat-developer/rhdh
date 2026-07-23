/**
 * Google Cloud SQL Auth Proxy helpers for showcase-runtime external DB tests.
 *
 * Installs the Auth Proxy as a native sidecar initContainer (`restartPolicy:
 * Always` + startupProbe) so the DB tunnel is up before backstage-backend
 * starts — matching RHIDP-7007 / RHIDP-12563 and the verified operator CR.
 *
 * Reuses runtime-deploy Helm/CR helpers and operator-install-profile ensureRecord.
 */

import { existsSync, readFileSync } from "fs";

import * as yaml from "yaml";

import { base64Encode, discoverRouterBase, resolveInstallMethod } from "./helper";
import { deploymentName as resolveDeploymentName } from "./instance-route-identity";
import { KubeClient, isRecord } from "./kube-client";
import { ensureRecord, type YamlRecord } from "./operator-install-profile";
import { pollUntil } from "./poll-until";
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

function secretNameRefs(value: unknown): Array<{ name: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  const refs: Array<{ name: string }> = [];
  for (const item of value) {
    if (isRecord(item) && typeof item.name === "string") {
      refs.push({ name: item.name });
    }
  }
  return refs;
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

function applyProxyToPodSpec(podSpec: YamlRecord, instanceConnectionName: string): void {
  const { container, volume } = buildCloudSqlProxySidecar(instanceConnectionName);
  podSpec.initContainers = upsertNamedRecord(asNamedRecordList(podSpec.initContainers), container);
  podSpec.volumes = upsertNamedRecord(asNamedRecordList(podSpec.volumes), volume);
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

async function waitForProxyOnDeployment(
  kubeClient: KubeClient,
  namespace: string,
  deploymentName: string,
  instanceConnectionName: string,
): Promise<void> {
  await pollUntil(
    async () => {
      const response = await kubeClient.appsApi.readNamespacedDeployment(deploymentName, namespace);
      const initContainers = response.body.spec?.template?.spec?.initContainers ?? [];
      return initContainers.some(
        (container) =>
          container.name === CLOUD_SQL_PROXY_CONTAINER &&
          (container.args ?? []).includes(instanceConnectionName),
      );
    },
    {
      timeoutMs: 120_000,
      intervalMs: 5_000,
      label: `Cloud SQL Auth Proxy initContainer on ${deploymentName}`,
    },
  );
}

function applyCloudSqlToBackstageCr(cr: BackstageCR, instanceConnectionName: string): BackstageCR {
  const spec = cr.spec;
  spec.database = { enableLocalDb: false };

  const application = ensureRecord(spec, "application");
  const extraEnvs = ensureRecord(application, "extraEnvs");
  const secrets = secretNameRefs(extraEnvs.secrets);
  if (!secrets.some((s) => s.name === "postgres-cred")) {
    secrets.push({ name: "postgres-cred" });
  }
  if (!secrets.some((s) => s.name === "rhdh-runtime-config")) {
    secrets.push({ name: "rhdh-runtime-config" });
  }
  extraEnvs.secrets = secrets;

  const deployment = ensureRecord(spec, "deployment");
  const patch = ensureRecord(deployment, "patch");
  const patchSpec = ensureRecord(patch, "spec");
  const template = ensureRecord(patchSpec, "template");
  const podSpec = ensureRecord(template, "spec");
  applyProxyToPodSpec(podSpec, instanceConnectionName);

  return cr;
}

/**
 * Install/update the Auth Proxy native sidecar and disable local Postgres.
 * Helm: values overlay + Deployment initContainer patch (keeps chart initContainers).
 * Operator: Backstage CR patch (reconcile-safe).
 */
export async function injectCloudSqlSidecar(
  kubeClient: KubeClient,
  namespace: string,
  releaseName: string,
  instanceConnectionName: string,
): Promise<void> {
  const installMethod = resolveInstallMethod();
  const deploymentName = resolveDeploymentName(installMethod, releaseName);

  if (installMethod === "helm") {
    const routerBase = process.env.K8S_CLUSTER_ROUTER_BASE ?? (await discoverRouterBase());
    const config = { ...resolveConfig(routerBase), releaseName, namespace };
    await upgradeRuntimeHelmRelease(config, generateCloudSqlHelmValuesOverlay());
    await upsertCloudSqlProxyOnDeployment(
      kubeClient,
      namespace,
      deploymentName,
      instanceConnectionName,
    );
  } else {
    const cr = await getRuntimeBackstageCr(kubeClient, namespace, releaseName);
    applyCloudSqlToBackstageCr(cr, instanceConnectionName);
    await replaceRuntimeBackstageCr(kubeClient, namespace, releaseName, cr);
    await waitForProxyOnDeployment(kubeClient, namespace, deploymentName, instanceConnectionName);
  }

  // Rollout: native sidecar startupProbe must pass before backstage-backend is Ready.
  await kubeClient.restartDeploymentWithRetry(deploymentName, namespace);
}

/**
 * Rotate the Auth Proxy target instance. Operator updates the CR (reconcile-safe);
 * Helm patches the live Deployment (postgresql already disabled from prepare).
 * Restart waits until the native sidecar startupProbe passes before RHDH is Ready.
 */
export async function configureCloudSqlProxyInstance(
  kubeClient: KubeClient,
  namespace: string,
  releaseName: string,
  instanceConnectionName: string,
): Promise<void> {
  const installMethod = resolveInstallMethod();
  const deploymentName = resolveDeploymentName(installMethod, releaseName);

  if (installMethod === "operator") {
    const cr = await getRuntimeBackstageCr(kubeClient, namespace, releaseName);
    applyCloudSqlToBackstageCr(cr, instanceConnectionName);
    await replaceRuntimeBackstageCr(kubeClient, namespace, releaseName, cr);
    await waitForProxyOnDeployment(kubeClient, namespace, deploymentName, instanceConnectionName);
  } else {
    await upsertCloudSqlProxyOnDeployment(
      kubeClient,
      namespace,
      deploymentName,
      instanceConnectionName,
    );
  }

  await kubeClient.restartDeploymentWithRetry(deploymentName, namespace);
}
