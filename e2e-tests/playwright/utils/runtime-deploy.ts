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
 *   K8S_CLUSTER_URL, K8S_CLUSTER_TOKEN  — cluster access
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
 *   SCHEMA_MODE_*         — schema-mode env vars for port-forwarding
 */

import { execFile } from "child_process";
import { promisify } from "util";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { KubeClient, getRhdhDeploymentName } from "./kube-client";
import {
  resolveConfig,
  generateHelmValuesYaml,
  generateHelmSetArgs,
  generateAppConfigYaml,
  generateDynamicPluginsYaml,
  generateBackstageCR,
} from "./runtime-config";

const execFileAsync = promisify(execFile);

/** Whether deploy has already run in this process */
let deployed = false;

/**
 * Detect install method from environment.
 */
function resolveInstallMethod(): "helm" | "operator" {
  if (process.env.INSTALL_METHOD === "operator") return "operator";
  if (process.env.INSTALL_METHOD === "helm") return "helm";
  const job = process.env.JOB_NAME || "";
  return job.includes("operator") ? "operator" : "helm";
}

/**
 * Run a shell command and return stdout. Throws on non-zero exit.
 */
async function run(
  cmd: string,
  args: string[],
  options?: { timeout?: number },
): Promise<string> {
  const timeout = options?.timeout ?? 300_000;
  console.log(`  $ ${cmd} ${args.join(" ")}`);
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    maxBuffer: 10 * 1024 * 1024,
    timeout,
  });
  if (stderr) {
    // Helm and oc print warnings to stderr that are not errors
    for (const line of stderr.split("\n").filter(Boolean)) {
      console.log(`  (stderr) ${line}`);
    }
  }
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Namespace management
// ---------------------------------------------------------------------------

async function deleteNamespaceIfExists(
  kubeClient: KubeClient,
  namespace: string,
): Promise<void> {
  try {
    const ns = await kubeClient.getNamespaceByName(namespace);
    if (!ns) return;
    console.log(`Deleting namespace ${namespace}...`);
    await kubeClient.deleteNamespaceAndWait(namespace);
    console.log(`Namespace ${namespace} deleted`);
  } catch (err: unknown) {
    const code = (err as { response?: { statusCode?: number } })?.response
      ?.statusCode;
    if (code === 404) return; // already gone
    throw err;
  }
}

async function createNamespace(
  kubeClient: KubeClient,
  namespace: string,
): Promise<void> {
  console.log(`Creating namespace ${namespace}...`);
  await kubeClient.coreV1Api.createNamespace({
    metadata: { name: namespace },
  });
  console.log(`Namespace ${namespace} created`);
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

async function createPlaceholderSecrets(
  kubeClient: KubeClient,
  namespace: string,
): Promise<void> {
  const encode = (s: string) => Buffer.from(s).toString("base64");

  // postgres-cred — placeholder overwritten by external DB tests
  await kubeClient.createOrUpdateSecret(
    {
      metadata: { name: "postgres-cred" },
      data: {
        POSTGRES_PASSWORD: encode("tmp"),
        POSTGRES_PORT: encode("5432"),
        POSTGRES_USER: encode("janus-idp"),
        POSTGRES_HOST: encode("tmp"),
        PGSSLMODE: encode("disable"), // internal DB has no TLS
        NODE_EXTRA_CA_CERTS: encode("/opt/app-root/src/postgres-crt.pem"),
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
    throw new Error(
      "CHART_VERSION environment variable is required for Helm deployment",
    );
  }

  const { namespace, releaseName } = config;
  const { chartUrl, chartVersion } = config.helm;

  // Create PVC for dynamic plugins — persists extracted plugins across
  // deployment restarts (config-map and schema-mode tests both restart RHDH).
  const pvcName = `${releaseName}-dynamic-plugins-root`;
  try {
    await kubeClient.coreV1Api.createNamespacedPersistentVolumeClaim(
      namespace,
      {
        metadata: { name: pvcName },
        spec: {
          accessModes: ["ReadWriteOnce"],
          resources: { requests: { storage: "5Gi" } },
        },
      },
    );
    console.log(`PVC ${pvcName} created`);
  } catch (err: unknown) {
    const code = (err as { response?: { statusCode?: number } })?.response
      ?.statusCode;
    if (code === 409) {
      console.log(`PVC ${pvcName} already exists`);
    } else {
      throw err;
    }
  }

  // Generate values YAML and write to a temp file
  const valuesYaml = generateHelmValuesYaml();
  const tmpValuesFile = path.join(
    os.tmpdir(),
    `rhdh-runtime-values-${Date.now()}.yaml`,
  );
  fs.writeFileSync(tmpValuesFile, valuesYaml, "utf-8");
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
      "10m",
    ];

    console.log("Installing RHDH via Helm...");
    await run("helm", helmArgs, { timeout: 600_000 });
    console.log("Helm install complete");
  } finally {
    // Clean up temp file
    try {
      fs.unlinkSync(tmpValuesFile);
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
    if (host) return `https://${host}`;
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
  const runtimeUrl = `https://backstage-${releaseName}-${namespace}.${routerBase}`;

  // 1. Create app-config ConfigMap (generated from runtime-config.ts)
  const appConfigYaml = generateAppConfigYaml(runtimeUrl);
  await kubeClient.coreV1Api.createNamespacedConfigMap(namespace, {
    metadata: { name: "app-config-rhdh" },
    data: { "app-config-rhdh.yaml": appConfigYaml },
  });
  console.log("Created app-config-rhdh ConfigMap");

  // 2. Create rhdh-runtime-config secret (carries RHDH_RUNTIME_URL for env injection)
  await kubeClient.createOrUpdateSecret(
    {
      metadata: { name: "rhdh-runtime-config" },
      data: {
        RHDH_RUNTIME_URL: Buffer.from(runtimeUrl).toString("base64"),
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
  await kubeClient.coreV1Api.createNamespacedConfigMap(namespace, {
    metadata: { name: "dynamic-plugins" },
    data: { "dynamic-plugins.yaml": dpYaml },
  });
  console.log("Created dynamic-plugins ConfigMap (no dynamic plugins)");

  // 4. Wait for Backstage CRD to be available
  console.log("Waiting for Backstage CRD...");
  const crdName = "backstages.rhdh.redhat.com";
  for (let i = 0; i < 12; i++) {
    try {
      await kubeClient.customObjectsApi.getClusterCustomObject(
        "apiextensions.k8s.io",
        "v1",
        "customresourcedefinitions",
        crdName,
      );
      console.log("Backstage CRD is available");
      break;
    } catch {
      if (i === 11) throw new Error(`CRD ${crdName} not available after 60s`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  // 5. Apply Backstage CR (generated from runtime-config.ts)
  const crObj = generateBackstageCR(config);
  const apiVersion = (crObj.apiVersion as string) || "rhdh.redhat.com/v1alpha5";
  const [group, version] = apiVersion.split("/");
  await kubeClient.customObjectsApi.createNamespacedCustomObject(
    group,
    version,
    namespace,
    "backstages",
    crObj,
  );
  console.log(
    `Applied Backstage CR '${(crObj.metadata as { name: string }).name}'`,
  );

  // 6. Wait for the operator to create the deployment
  console.log("Waiting for operator to create the deployment...");
  const deploymentName = `backstage-${releaseName}`;
  for (let i = 0; i < 60; i++) {
    try {
      await kubeClient.appsApi.readNamespacedDeployment(
        deploymentName,
        namespace,
      );
      console.log(`Deployment ${deploymentName} found`);
      break;
    } catch {
      if (i === 59)
        throw new Error(
          `Operator did not create deployment ${deploymentName} after 5 minutes`,
        );
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  // 7. Wait for deployment readiness
  await kubeClient.waitForDeploymentReady(
    deploymentName,
    namespace,
    1,
    600_000,
  );
  console.log("Operator deployment ready");

  return runtimeUrl;
}

// ---------------------------------------------------------------------------
// Schema-mode environment
// ---------------------------------------------------------------------------

/**
 * Discover PostgreSQL service and admin password in the runtime namespace
 * and set SCHEMA_MODE_* environment variables for schema-mode tests.
 */
async function configureSchemaMode(
  kubeClient: KubeClient,
  namespace: string,
  releaseName: string,
  installMethod: "helm" | "operator",
): Promise<void> {
  // Find PostgreSQL service
  const svcCandidates =
    installMethod === "operator"
      ? [`backstage-psql-${releaseName}`, `${releaseName}-postgresql`]
      : [`${releaseName}-postgresql`, `backstage-psql-${releaseName}`];

  let svcName: string | undefined;
  for (const candidate of svcCandidates) {
    try {
      await kubeClient.coreV1Api.readNamespacedService(candidate, namespace);
      svcName = candidate;
      break;
    } catch {
      // not found, try next
    }
  }

  if (!svcName) {
    console.warn(
      "No PostgreSQL service found in namespace — schema-mode tests will skip",
    );
    return;
  }

  // Find admin password
  const secretCandidates =
    installMethod === "operator"
      ? [
          `backstage-psql-secret-${releaseName}`,
          `${releaseName}-postgresql`,
          "postgres-cred",
        ]
      : [
          `${releaseName}-postgresql`,
          `backstage-psql-secret-${releaseName}`,
          "postgres-cred",
        ];

  const passwordKeys = [
    "postgres-password",
    "POSTGRESQL_ADMIN_PASSWORD",
    "POSTGRES_PASSWORD",
  ];

  let adminPassword: string | undefined;
  for (const sec of secretCandidates) {
    try {
      const result = await kubeClient.coreV1Api.readNamespacedSecret(
        sec,
        namespace,
      );
      const data = result.body.data || {};
      for (const key of passwordKeys) {
        if (data[key]) {
          adminPassword = Buffer.from(data[key], "base64").toString("utf-8");
          break;
        }
      }
      if (adminPassword) break;
    } catch {
      // not found, try next
    }
  }

  if (!adminPassword) {
    console.warn(
      "Could not resolve PostgreSQL admin password — schema-mode tests will skip",
    );
    return;
  }

  // Export schema-mode env vars
  process.env.SCHEMA_MODE_PORT_FORWARD_NAMESPACE = namespace;
  process.env.SCHEMA_MODE_PORT_FORWARD_RESOURCE = `svc/${svcName}`;
  process.env.SCHEMA_MODE_DB_ADMIN_USER = "postgres";
  process.env.SCHEMA_MODE_DB_ADMIN_PASSWORD = adminPassword;
  process.env.SCHEMA_MODE_DB_PASSWORD =
    process.env.SCHEMA_MODE_DB_PASSWORD || "test_password_123";
  process.env.SCHEMA_MODE_DB_USER =
    process.env.SCHEMA_MODE_DB_USER || "bn_backstage";

  console.log(
    `Schema-mode env configured: port-forward svc/${svcName} in ${namespace}`,
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
  const routerBase =
    process.env.K8S_CLUSTER_ROUTER_BASE || (await discoverRouterBase());

  const config = resolveConfig(routerBase);
  const { namespace, releaseName } = config;

  console.log(
    `\n=== Runtime deployment (${installMethod}) ===\n` +
      `  namespace:    ${namespace}\n` +
      `  releaseName:  ${releaseName}\n` +
      `  routerBase:   ${routerBase}\n` +
      `  image:        ${config.image.registry}/${config.image.repository}:${config.image.tag}\n` +
      (config.catalogIndex
        ? `  catalogIndex: ${config.catalogIndex.registry}/${config.catalogIndex.repository}:${config.catalogIndex.tag}\n`
        : `  catalogIndex: (chart/operator default)\n`),
  );

  const kubeClient = new KubeClient();

  // Check if deployment already exists and is ready
  const deploymentName = getRhdhDeploymentName();
  try {
    const dep = await kubeClient.appsApi.readNamespacedDeployment(
      deploymentName,
      namespace,
    );
    const ready = dep.body.status?.readyReplicas ?? 0;
    if (ready >= 1) {
      console.log(
        `Deployment ${deploymentName} already running (${ready} ready replicas) — skipping deploy`,
      );
      deployed = true;
      // Still configure schema-mode env if not already set
      if (!process.env.SCHEMA_MODE_DB_ADMIN_PASSWORD) {
        await configureSchemaMode(
          kubeClient,
          namespace,
          releaseName,
          installMethod,
        );
      }
      return;
    }
  } catch {
    // Deployment doesn't exist — proceed with fresh deploy
  }

  // Fresh deployment
  await deleteNamespaceIfExists(kubeClient, namespace);
  await createNamespace(kubeClient, namespace);
  await createPlaceholderSecrets(kubeClient, namespace);

  let runtimeUrl: string;
  if (installMethod === "helm") {
    runtimeUrl = await deployWithHelm(kubeClient, config);
  } else {
    runtimeUrl = await deployWithOperator(kubeClient, config);
  }

  // Set BASE_URL if not already set
  if (!process.env.BASE_URL) {
    process.env.BASE_URL = runtimeUrl;
    console.log(`BASE_URL set to ${runtimeUrl}`);
  }

  // Configure schema-mode env vars
  await configureSchemaMode(kubeClient, namespace, releaseName, installMethod);

  deployed = true;
  console.log("\n=== Runtime deployment complete ===\n");
}

/**
 * Discover the cluster router base from the OpenShift console route.
 */
async function discoverRouterBase(): Promise<string> {
  try {
    const output = await run("oc", [
      "get",
      "route",
      "console",
      "-n",
      "openshift-console",
      "-o",
      "jsonpath={.spec.host}",
    ]);
    return output.replace(/^console-openshift-console\./, "");
  } catch {
    throw new Error(
      "K8S_CLUSTER_ROUTER_BASE not set and could not discover from cluster",
    );
  }
}
