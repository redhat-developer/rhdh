/**
 * Runtime deployment utility for SHOWCASE_RUNTIME tests.
 *
 * Deploys RHDH with an internal PostgreSQL database via Helm sub-chart
 * (helm) or operator-managed StatefulSet (operator). Called from
 * Playwright globalSetup when RUNTIME_AUTO_DEPLOY=true (and still safe
 * to call from a spec beforeAll — idempotent via a process-local flag
 * and an existing-deployment check). Subsequent specs reuse the
 * deployment since the project runs with workers: 1.
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
 *   BASE_URL              — RHDH route URL (always set to the instance URL)
 *   SCHEMA_MODE_*         — schema-mode env vars (via configureSchemaMode in schema-mode-db.ts)
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { configureSchemaMode } from "../e2e/plugin-division-mode-schema/schema-mode-db";
import {
  resolveInstallMethod,
  base64Encode,
  run,
  discoverRouterBase,
  imageRefToString,
} from "./helper";
import {
  createInstanceRouteIdentity,
  deploymentName,
  predictedUrl,
  routeObjectName,
} from "./instance-route-identity";
import {
  KubeClient,
  getErrorStatusCode,
  getRhdhDeploymentName,
  isRecord,
  waitForBackstageCrd,
} from "./kube-client";
import {
  resolveConfig,
  generateHelmValuesYaml,
  generateHelmSetArgs,
  generateAppConfigYaml,
  generateDynamicPluginsYaml,
  generateBackstageCR,
  BACKSTAGE_CR_API_VERSION,
} from "./runtime-config";

/**
 * Whether deploy has already run in this process.
 * Safe as a bare boolean because the showcase-runtime project runs with
 * `workers: 1` (see playwright.config.ts) — there is exactly one namespace
 * and one releaseName per process lifetime.
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

  const valuesYaml = generateHelmValuesYaml();
  console.log("Installing RHDH via Helm...");
  await upgradeRuntimeHelmRelease(config, valuesYaml);
  console.log("Helm install complete");

  // Read the actual route URL from the cluster; fall back to predicted helm URL.
  const identity = createInstanceRouteIdentity("helm", releaseName, namespace, config.routerBase);
  const routeName = routeObjectName("helm", releaseName);
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
  return predictedUrl(identity);
}

// ---------------------------------------------------------------------------
// Operator deployment
// ---------------------------------------------------------------------------

async function deployWithOperator(
  kubeClient: KubeClient,
  config: ReturnType<typeof resolveConfig>,
): Promise<string> {
  const { namespace, releaseName, routerBase } = config;
  // Operator route naming is deterministic — InstanceRouteIdentity owns the formula.
  const runtimeUrl = predictedUrl(
    createInstanceRouteIdentity("operator", releaseName, namespace, routerBase),
  );

  // 1. Create app-config ConfigMap (generated from runtime-config.ts)
  const appConfigYaml = generateAppConfigYaml(runtimeUrl);
  await kubeClient.createConfigMap(namespace, {
    metadata: { name: "app-config-rhdh" },
    data: { "app-config-rhdh.yaml": appConfigYaml },
  });
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
  // Runtime tests only need a basic RHDH instance (config-map changes, DB
  // connectivity). An empty plugins list gives us a clean RHDH with only
  // built-in plugins — no external config needed.
  const dpYaml = generateDynamicPluginsYaml();
  await kubeClient.createConfigMap(namespace, {
    metadata: { name: "dynamic-plugins" },
    data: { "dynamic-plugins.yaml": dpYaml },
  });
  console.log("Created dynamic-plugins ConfigMap (no dynamic plugins)");

  // 4. Wait for Backstage CRD to be available
  await waitForBackstageCrd(kubeClient.customObjectsApi);

  // 5. Apply Backstage CR (generated from runtime-config.ts)
  const crObj = generateBackstageCR(config);
  const apiVersion = crObj.apiVersion || BACKSTAGE_CR_API_VERSION;
  const [group, version] = apiVersion.split("/");
  await kubeClient.customObjectsApi.createNamespacedCustomObject(
    group,
    version,
    namespace,
    "backstages",
    crObj,
  );
  console.log(`Applied Backstage CR '${(crObj.metadata as { name: string }).name}'`);

  // 6. Wait for the operator to create the deployment
  console.log("Waiting for operator to create the deployment...");
  const operatorDeploymentName = deploymentName("operator", releaseName);
  for (let i = 0; i < 60; i++) {
    try {
      await kubeClient.appsApi.readNamespacedDeployment(operatorDeploymentName, namespace);
      console.log(`Deployment ${operatorDeploymentName} found`);
      break;
    } catch {
      if (i === 59)
        throw new Error(
          `Operator did not create deployment ${operatorDeploymentName} after 5 minutes`,
        );
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve();
        }, 5000);
      });
    }
  }

  // 7. Wait for deployment readiness
  await kubeClient.waitForDeploymentReady(operatorDeploymentName, namespace, 1, 600_000);
  console.log("Operator deployment ready");

  return runtimeUrl;
}

// ---------------------------------------------------------------------------
// Shared Helm / Operator CR helpers (used by runtime deploy + external DB)
// ---------------------------------------------------------------------------

/**
 * `helm upgrade -i` the runtime release with the given values YAML.
 * Shared by initial deploy and external-DB overlays (e.g. Cloud SQL).
 */
export async function upgradeRuntimeHelmRelease(
  config: ReturnType<typeof resolveConfig>,
  valuesYaml: string,
): Promise<void> {
  if (!config.helm) {
    throw new Error("CHART_VERSION environment variable is required for Helm deployment");
  }

  const { namespace, releaseName } = config;
  const { chartUrl, chartVersion } = config.helm;
  const tmpValuesFile = path.join(os.tmpdir(), `rhdh-runtime-values-${Date.now()}.yaml`);
  fs.writeFileSync(tmpValuesFile, valuesYaml, "utf-8");
  console.log(`Generated Helm values written to ${tmpValuesFile}`);

  try {
    await run(
      "helm",
      [
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
        "10m",
      ],
      { timeout: 600_000 },
    );
  } finally {
    try {
      fs.unlinkSync(tmpValuesFile);
    } catch {
      // ignore cleanup errors
    }
  }
}

function parseBackstageApiVersion(apiVersion: string): { group: string; version: string } {
  const [group, version] = apiVersion.split("/");
  if (group === undefined || version === undefined || group === "" || version === "") {
    throw new Error(`Invalid Backstage CR apiVersion: ${apiVersion}`);
  }
  return { group, version };
}

function isRuntimeBackstageCr(value: unknown): value is ReturnType<typeof generateBackstageCR> {
  return (
    isRecord(value) &&
    value.kind === "Backstage" &&
    typeof value.apiVersion === "string" &&
    isRecord(value.metadata) &&
    typeof value.metadata.name === "string" &&
    isRecord(value.spec)
  );
}

/** Read the live Backstage CR for the runtime release. */
export async function getRuntimeBackstageCr(
  kubeClient: KubeClient,
  namespace: string,
  releaseName: string,
): Promise<ReturnType<typeof generateBackstageCR>> {
  const { group, version } = parseBackstageApiVersion(BACKSTAGE_CR_API_VERSION);
  const response = await kubeClient.customObjectsApi.getNamespacedCustomObject(
    group,
    version,
    namespace,
    "backstages",
    releaseName,
  );
  if (!isRuntimeBackstageCr(response.body)) {
    throw new TypeError(`Backstage CR '${releaseName}' has unexpected shape`);
  }
  return response.body;
}

/** Replace the live Backstage CR (operator reconciles the Deployment). */
export async function replaceRuntimeBackstageCr(
  kubeClient: KubeClient,
  namespace: string,
  releaseName: string,
  cr: ReturnType<typeof generateBackstageCR>,
): Promise<void> {
  const { group, version } = parseBackstageApiVersion(cr.apiVersion || BACKSTAGE_CR_API_VERSION);
  await kubeClient.customObjectsApi.replaceNamespacedCustomObject(
    group,
    version,
    namespace,
    "backstages",
    releaseName,
    cr,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
  const existingDeploymentName = getRhdhDeploymentName();
  const runtimeUrl = predictedUrl(
    createInstanceRouteIdentity(installMethod, releaseName, namespace, routerBase),
  );
  try {
    const dep = await kubeClient.appsApi.readNamespacedDeployment(
      existingDeploymentName,
      namespace,
    );
    const ready = dep.body.status?.readyReplicas ?? 0;
    if (ready >= 1) {
      console.log(
        `Deployment ${existingDeploymentName} already running (${ready} ready replicas) — skipping deploy`,
      );
      // Always publish the instance URL — overwrite router-stub / empty BASE_URL.
      process.env.BASE_URL = runtimeUrl;
      console.log(`BASE_URL set to ${runtimeUrl}`);
      deployed = true;
      // Still configure schema-mode env if not already set
      if (
        process.env.SCHEMA_MODE_DB_ADMIN_PASSWORD === undefined ||
        process.env.SCHEMA_MODE_DB_ADMIN_PASSWORD === ""
      ) {
        await configureSchemaMode(kubeClient, namespace, releaseName, installMethod);
      }
      return;
    }
  } catch {
    // Deployment doesn't exist — proceed with fresh deploy
  }

  // Fresh deployment
  await kubeClient.deleteNamespaceIfExists(namespace);
  await kubeClient.createNamespace(namespace);
  await createPlaceholderSecrets(kubeClient, namespace);

  let deployedUrl: string;
  if (installMethod === "helm") {
    deployedUrl = await deployWithHelm(kubeClient, config);
  } else {
    deployedUrl = await deployWithOperator(kubeClient, config);
  }

  // Always publish the instance URL — overwrite router-stub / empty BASE_URL so
  // ensurePlaywrightReady can reclassify after RUNTIME_AUTO_DEPLOY.
  process.env.BASE_URL = deployedUrl;
  console.log(`BASE_URL set to ${deployedUrl}`);

  // Configure schema-mode env vars
  await configureSchemaMode(kubeClient, namespace, releaseName, installMethod);

  deployed = true;
  console.log("\n=== Runtime deployment complete ===\n");
}
