/**
 * Runtime deployment utility for SHOWCASE_RUNTIME tests.
 *
 * Deploys RHDH with an internal PostgreSQL database via Helm sub-chart
 * (helm) or operator-managed StatefulSet (operator). The deployment
 * happens once in the first test file's beforeAll — subsequent specs
 * reuse the existing deployment since the project runs with workers: 1.
 *
 * All deployment configuration is generated from `runtime-config.ts` —
 * a single source of truth that produces Helm values YAML, Operator
 * app-config, dynamic-plugins ConfigMaps, and the Backstage CR.
 *
 * Environment variables consumed:
 *   RELEASE_NAME          — Helm release / CR name (default: "rhdh")
 *   NAME_SPACE_RUNTIME    — target namespace (default: "showcase-runtime")
 *   INSTALL_METHOD         — "helm" or "operator" (default: from JOB_NAME)
 *   IMAGE_REGISTRY, IMAGE_REPO, TAG_NAME — RHDH container image
 *   HELM_CHART_URL, CHART_VERSION        — Helm chart OCI ref + version
 *   CATALOG_INDEX_IMAGE                   — opt-in catalog index override
 *   K8S_CLUSTER_ROUTER_BASE              — cluster router base domain
 *
 * Environment variables exported after deployment:
 *   BASE_URL              — RHDH route URL (set only if not already set)
 *   SCHEMA_MODE_*         — schema-mode env vars (via configureSchemaMode in schema-mode-db.ts)
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { configureSchemaMode } from "../e2e/plugin-division-mode-schema/schema-mode-db";
import { isCloudSqlRevisionReady, buildCloudSqlEgressPolicy } from "./cloudsql-config";
import {
  resolveInstallMethod,
  base64Encode,
  run,
  discoverRouterBase,
  imageRefToString,
} from "./helper";
import {
  KubeClient,
  getErrorStatusCode,
  getRhdhDeploymentName,
  waitForBackstageCrd,
  isRecord,
} from "./kube-client";
import { getKubeApiErrorMessage } from "./kube-client/helpers";
import { pollUntil } from "./poll-until";
import {
  resolveConfig,
  generateHelmValuesYaml,
  generateHelmSetArgs,
  generateAppConfigYaml,
  generateDynamicPluginsYaml,
  generateBackstageCR,
  BACKSTAGE_CR_API_VERSION,
  type RuntimeDeployConfig,
} from "./runtime-config";

/** How long `helm --wait` waits for the release to become ready. */
const HELM_WAIT_TIMEOUT_MINUTES = 10;

/**
 * How long we let the helm PROCESS run. Deliberately longer than
 * HELM_WAIT_TIMEOUT_MINUTES so helm always wins the race and gets to print why
 * it gave up; killing it at the same instant leaves only a truncated
 * "Command failed" with none of the diagnosis.
 */
const HELM_PROCESS_TIMEOUT_MS = (HELM_WAIT_TIMEOUT_MINUTES + 2) * 60 * 1000;

/**
 * Whether deploy has already run in this process.
 * Safe as a bare boolean because the showcase-runtime project runs with
 * `workers: 1` (see playwright.config.ts). This cache belongs only to the
 * default internal-DB target; explicit Cloud SQL targets do not use it.
 */
let deployed = false;

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

async function createPlaceholderSecrets(kubeClient: KubeClient, namespace: string): Promise<void> {
  // postgres-cred — placeholder overwritten by external DB tests
  await kubeClient.createOrUpdateSecret(
    {
      metadata: { name: "postgres-cred" },
      data: {
        POSTGRES_PASSWORD: base64Encode("tmp"),
        POSTGRES_PORT: base64Encode("5432"),
        POSTGRES_USER: base64Encode("janus-idp"),
        POSTGRES_HOST: base64Encode("tmp"),
        // internal DB has no TLS
        PGSSLMODE: base64Encode("disable"),
        NODE_EXTRA_CA_CERTS: base64Encode("/opt/app-root/src/postgres-crt.pem"),
      },
    },
    namespace,
  );

  // postgres-crt — placeholder certificate
  await kubeClient.createOrUpdateSecret(
    {
      metadata: { name: "postgres-crt" },
      type: "Opaque",
      stringData: { "postgres-crt.pem": "placeholder" },
    },
    namespace,
  );

  console.log("Placeholder secrets created");
}

// ---------------------------------------------------------------------------
// Helm deployment
// ---------------------------------------------------------------------------

async function deployWithHelm(
  kubeClient: KubeClient,
  config: ReturnType<typeof resolveConfig>,
): Promise<string> {
  if (!config.helm) {
    throw new Error("CHART_VERSION environment variable is required for Helm deployment");
  }

  const { namespace, releaseName } = config;
  const { chartUrl, chartVersion } = config.helm;

  // Create PVC for dynamic plugins — persists extracted plugins across
  // deployment restarts (config-map and schema-mode tests both restart RHDH).
  const pvcName = `${releaseName}-dynamic-plugins-root`;
  try {
    await kubeClient.coreV1Api.createNamespacedPersistentVolumeClaim(namespace, {
      metadata: { name: pvcName },
      spec: {
        accessModes: ["ReadWriteOnce"],
        resources: { requests: { storage: "5Gi" } },
      },
    });
    console.log(`PVC ${pvcName} created`);
  } catch (err: unknown) {
    if (getErrorStatusCode(err) === 409) {
      console.log(`PVC ${pvcName} already exists`);
    } else {
      throw err;
    }
  }

  // Generate values YAML and write to a temp file
  const valuesYaml = generateHelmValuesYaml(config);
  const tempRoot = path.join(os.tmpdir(), "opencode");
  fs.mkdirSync(tempRoot, { recursive: true, mode: 0o700 });
  const tmpDir = fs.mkdtempSync(path.join(tempRoot, "rhdh-runtime-"));
  const tmpValuesFile = path.join(tmpDir, "values.yaml");
  fs.writeFileSync(tmpValuesFile, valuesYaml, { encoding: "utf-8", mode: 0o600 });
  console.log(`Generated Helm values written to ${tmpValuesFile}`);

  try {
    // Helm install
    const helmArgs = [
      "upgrade",
      "-i",
      releaseName,
      "-n",
      namespace,
      chartUrl,
      "--version",
      chartVersion,
      "-f",
      tmpValuesFile,
      ...generateHelmSetArgs(config),
      "--wait",
      "--timeout",
      `${HELM_WAIT_TIMEOUT_MINUTES}m`,
    ];

    console.log("Installing RHDH via Helm...");
    // The process timeout must stay ABOVE helm's own --timeout. When they are
    // equal, Node SIGTERMs helm at the same moment helm would have reported
    // why it gave up, so the error is truncated to whatever helm had already
    // written ("Pulled:", "Digest:") and the actual cause - which pod never
    // became ready - is lost on every single failure.
    await run("helm", helmArgs, { timeout: HELM_PROCESS_TIMEOUT_MS });
    console.log("Helm install complete");
  } finally {
    // Clean up temp file
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  // Read the actual route URL from the cluster
  const routeName = releaseName.includes("developer-hub")
    ? releaseName
    : `${releaseName}-developer-hub`;
  try {
    const route = await kubeClient.customObjectsApi.getNamespacedCustomObject(
      "route.openshift.io",
      "v1",
      namespace,
      "routes",
      routeName,
    );
    const host = (route.body as { spec?: { host?: string } })?.spec?.host;
    if (host !== undefined && host !== "") return `https://${host}`;
  } catch {
    // fall through to computed URL
  }
  return `https://${routeName}-${namespace}.${config.routerBase}`;
}

// ---------------------------------------------------------------------------
// Operator deployment
// ---------------------------------------------------------------------------

async function deployWithOperator(
  kubeClient: KubeClient,
  config: ReturnType<typeof resolveConfig>,
): Promise<string> {
  const { namespace, releaseName, routerBase } = config;
  // The operator creates a route named backstage-<release> whose host is
  // backstage-<release>-<namespace>.<routerBase> — this matches the CR's
  // spec.application.route.enabled naming convention. Unlike Helm (where
  // the chart can customise the route name), the operator's naming is
  // deterministic, so a computed URL is sufficient here.
  const runtimeUrl = `https://backstage-${releaseName}-${namespace}.${routerBase}`;

  // 1. Create app-config ConfigMap (generated from runtime-config.ts)
  const appConfigYaml = generateAppConfigYaml(runtimeUrl, config);
  const appConfigMap = {
    metadata: { name: "app-config-rhdh" },
    data: { "app-config-rhdh.yaml": appConfigYaml },
  };
  try {
    await kubeClient.createConfigMap(namespace, appConfigMap);
  } catch (error) {
    if (getErrorStatusCode(error) !== 409)
      throw new Error(getKubeApiErrorMessage(error), { cause: error });
    const existing = await kubeClient.coreV1Api.readNamespacedConfigMap(
      "app-config-rhdh",
      namespace,
    );
    await kubeClient.coreV1Api.replaceNamespacedConfigMap("app-config-rhdh", namespace, {
      ...appConfigMap,
      metadata: existing.body.metadata,
    });
  }
  console.log("Created app-config-rhdh ConfigMap");

  // 2. Create rhdh-runtime-config secret (carries RHDH_RUNTIME_URL for env injection)
  await kubeClient.createOrUpdateSecret(
    {
      metadata: { name: "rhdh-runtime-config" },
      data: {
        RHDH_RUNTIME_URL: base64Encode(runtimeUrl),
      },
    },
    namespace,
  );
  console.log("Created rhdh-runtime-config Secret");

  // 3. Create dynamic-plugins ConfigMap.
  // Select the ordinary runtime profile or Cloud SQL's Helm-equivalent profile.
  const dpYaml = generateDynamicPluginsYaml(config);
  try {
    await kubeClient.createConfigMap(namespace, {
      metadata: { name: "dynamic-plugins" },
      data: { "dynamic-plugins.yaml": dpYaml },
    });
  } catch (error) {
    if (getErrorStatusCode(error) !== 409) throw error;
  }
  console.log("Created runtime dynamic-plugins ConfigMap");

  // 4. Wait for Backstage CRD to be available
  await waitForBackstageCrd(kubeClient.customObjectsApi);

  // 5. Apply Backstage CR (generated from runtime-config.ts)
  const crObj = generateBackstageCR(config);
  const apiVersion = crObj.apiVersion || BACKSTAGE_CR_API_VERSION;
  const [group, version] = apiVersion.split("/");
  try {
    await kubeClient.customObjectsApi.createNamespacedCustomObject(
      group,
      version,
      namespace,
      "backstages",
      crObj,
    );
  } catch (error) {
    if (getErrorStatusCode(error) !== 409)
      throw new Error(getKubeApiErrorMessage(error), { cause: error });
    const existing = await kubeClient.customObjectsApi.getNamespacedCustomObject(
      group,
      version,
      namespace,
      "backstages",
      releaseName,
    );
    if (!isRecord(existing.body) || !isRecord(existing.body.metadata))
      throw new Error("Backstage CR has no metadata", { cause: error });
    crObj.metadata.resourceVersion = existing.body.metadata.resourceVersion;
    await kubeClient.customObjectsApi.replaceNamespacedCustomObject(
      group,
      version,
      namespace,
      "backstages",
      releaseName,
      crObj,
    );
  }
  console.log(`Applied Backstage CR '${(crObj.metadata as { name: string }).name}'`);

  // 6. Wait for the operator to create the deployment
  console.log("Waiting for operator to create the deployment...");
  const deploymentName = `backstage-${releaseName}`;
  for (let i = 0; i < 60; i++) {
    try {
      await kubeClient.appsApi.readNamespacedDeployment(deploymentName, namespace);
      console.log(`Deployment ${deploymentName} found`);
      break;
    } catch (error) {
      if (getErrorStatusCode(error) !== 404) throw error;
      if (i === 59)
        throw new Error(`Operator did not create deployment ${deploymentName} after 5 minutes`, {
          cause: error,
        });
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve();
        }, 5000);
      });
    }
  }

  await waitForRuntimeRevision(kubeClient, config, deploymentName);
  // 7. Wait for deployment readiness
  await kubeClient.waitForDeploymentReady(deploymentName, namespace, 1, 600_000);
  console.log("Operator deployment ready");

  return runtimeUrl;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RuntimeDeploymentHandle {
  namespace: string;
  releaseName: string;
  deploymentName: string;
  baseURL: string;
}

/** Wait for reconciliation of this target, not readiness of its previous revision. */
async function waitForRuntimeRevision(
  kubeClient: KubeClient,
  config: RuntimeDeployConfig,
  deploymentName: string,
): Promise<void> {
  if (!config.cloudSql) return;
  const cloudSql = config.cloudSql;
  await pollUntil(
    async () => {
      const { body } = await kubeClient.appsApi.readNamespacedDeployment(
        deploymentName,
        config.namespace,
      );
      return isCloudSqlRevisionReady(body, cloudSql);
    },
    { timeoutMs: 600_000, intervalMs: 2_000, label: "Cloud SQL deployment revision" },
  );
}

/** Deploy an explicit target without changing BASE_URL, schema-mode env, or the default runtime cache. */
export async function deployRuntime(
  config: RuntimeDeployConfig,
  installMethod: "helm" | "operator",
  kubeClient: KubeClient,
): Promise<RuntimeDeploymentHandle> {
  await createPlaceholderSecrets(kubeClient, config.namespace);
  if (config.cloudSql && installMethod === "operator") {
    try {
      await kubeClient.customObjectsApi.createNamespacedCustomObject(
        "networking.k8s.io",
        "v1",
        config.namespace,
        "networkpolicies",
        buildCloudSqlEgressPolicy(getRhdhDeploymentName(installMethod, config.releaseName)),
      );
    } catch (error) {
      if (getErrorStatusCode(error) !== 409) throw error;
    }
  }
  const baseURL =
    installMethod === "helm"
      ? await deployWithHelm(kubeClient, config)
      : await deployWithOperator(kubeClient, config);
  const deploymentName = getRhdhDeploymentName(installMethod, config.releaseName);
  await waitForRuntimeRevision(kubeClient, config, deploymentName);
  await kubeClient.waitForDeploymentReady(deploymentName, config.namespace, 1, 600_000);
  return { namespace: config.namespace, releaseName: config.releaseName, deploymentName, baseURL };
}

async function publishRuntimeUrl(
  kubeClient: KubeClient,
  namespace: string,
  releaseName: string,
  installMethod: "helm" | "operator",
  routerBase: string,
): Promise<void> {
  if (process.env.BASE_URL !== undefined && process.env.BASE_URL !== "") return;
  const routeName = getRhdhDeploymentName(installMethod, releaseName);
  const route = await kubeClient.customObjectsApi.getNamespacedCustomObject(
    "route.openshift.io",
    "v1",
    namespace,
    "routes",
    routeName,
  );
  const host = (route.body as { spec?: { host?: string } }).spec?.host;
  process.env.BASE_URL = `https://${host !== undefined && host !== "" ? host : `${routeName}-${namespace}.${routerBase}`}`;
}

/**
 * Ensure the runtime RHDH instance is deployed and ready.
 *
 * Idempotent: if the deployment already exists and is ready, this is a no-op.
 * Called from the first test file's `beforeAll` in the `showcase-runtime`
 * project. Since the project runs with `workers: 1`, the deployment persists
 * across all subsequent test files.
 */
export async function ensureRuntimeDeployed(): Promise<void> {
  if (deployed) {
    console.log("Runtime deployment already completed in this process");
    return;
  }

  const installMethod = resolveInstallMethod();
  const routerBase = process.env.K8S_CLUSTER_ROUTER_BASE ?? (await discoverRouterBase());

  const config = resolveConfig(routerBase);
  const { namespace, releaseName } = config;

  console.log(
    `\n=== Runtime deployment (${installMethod}) ===\n` +
      `  namespace:    ${namespace}\n` +
      `  releaseName:  ${releaseName}\n` +
      `  routerBase:   ${routerBase}\n` +
      `  image:        ${imageRefToString(config.image)}\n` +
      (config.catalogIndex
        ? `  catalogIndex: ${imageRefToString(config.catalogIndex)}\n`
        : `  catalogIndex: (chart/operator default)\n`),
  );

  const kubeClient = new KubeClient();

  // Check if deployment already exists and is ready
  const deploymentName = getRhdhDeploymentName();
  let ready = 0;
  try {
    const dep = await kubeClient.appsApi.readNamespacedDeployment(deploymentName, namespace);
    ready = dep.body.status?.readyReplicas ?? 0;
  } catch (error) {
    if (getErrorStatusCode(error) !== 404) throw error;
    // Deployment doesn't exist — proceed with fresh deploy
  }
  if (ready >= 1) {
    console.log(
      `Deployment ${deploymentName} already running (${ready} ready replicas) — skipping deploy`,
    );
    await publishRuntimeUrl(kubeClient, namespace, releaseName, installMethod, routerBase);
    if (
      process.env.SCHEMA_MODE_DB_ADMIN_PASSWORD === undefined ||
      process.env.SCHEMA_MODE_DB_ADMIN_PASSWORD === ""
    ) {
      await configureSchemaMode(kubeClient, namespace, releaseName, installMethod);
    }
    deployed = true;
    return;
  }

  // Fresh deployment
  await kubeClient.deleteNamespaceIfExists(namespace);
  await kubeClient.createNamespace(namespace);
  await createPlaceholderSecrets(kubeClient, namespace);

  let runtimeUrl: string;
  if (installMethod === "helm") {
    runtimeUrl = await deployWithHelm(kubeClient, config);
  } else {
    runtimeUrl = await deployWithOperator(kubeClient, config);
  }

  // Set BASE_URL if not already set
  if (process.env.BASE_URL === undefined || process.env.BASE_URL === "") {
    process.env.BASE_URL = runtimeUrl;
    console.log(`BASE_URL set to ${runtimeUrl}`);
  }

  // Configure schema-mode env vars
  await configureSchemaMode(kubeClient, namespace, releaseName, installMethod);

  deployed = true;
  console.log("\n=== Runtime deployment complete ===\n");
}
