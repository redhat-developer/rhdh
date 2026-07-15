import { spawn } from "child_process";
import { promises as fs } from "fs";
import { join, resolve as resolvePath } from "path";

import * as k8s from "@kubernetes/client-node";
import { expect } from "@playwright/test";
import * as yaml from "yaml";

import { applyDynamicPluginsProfile } from "../../dynamic-plugins-profile";
import { isKubernetesConflictError } from "../../errors";
import { predictedUrl } from "../../instance-route-identity";
import { getKubeApiErrorMessage } from "../../kube-client/helpers";
import {
  applyOperatorInstallProfileToAppConfig,
  applyOperatorInstallProfileToCr,
} from "../../operator-install-profile";
import { pollUntil } from "../../poll-until";
import {
  BackstageCr,
  currentDirName,
  isBackstageCr,
  isDynamicPluginsConfig,
  isRecord,
  RHDHDeploymentState,
  rootDirName,
  yamlsDirName,
} from "./types";
import { ensureBackstageCRIsAvailable, waitForDeploymentReady } from "./wait";

async function writeLocalTestFile(
  filePath: string,
  content: string,
  message: string,
): Promise<void> {
  await fs.writeFile(filePath, content, "utf8");
  console.log(message);
}

function skipIfRunningLocal(state: RHDHDeploymentState, message: string): boolean {
  if (state.isRunningLocal) {
    console.log(message);
    return true;
  }
  return false;
}

export async function readYamlToJson(filePath: string): Promise<unknown> {
  const fileContent = await fs.readFile(filePath, "utf8");
  return yaml.parse(fileContent);
}

export async function createNamespace(state: RHDHDeploymentState): Promise<void> {
  if (state.isRunningLocal) {
    console.log("Skipping namespace creation as isRunningLocal is true.");
    return;
  }

  const namespaceObj: k8s.V1Namespace = {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: {
      name: state.namespace,
    },
  };

  try {
    await state.k8sApi.createNamespace(namespaceObj);
  } catch (e) {
    if (isKubernetesConflictError(e)) {
      return;
    }
    throw e;
  }
}

async function createConfigMap(
  state: RHDHDeploymentState,
  name: string,
  data: Record<string, string>,
): Promise<void> {
  const configMap: k8s.V1ConfigMap = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name,
      namespace: state.namespace,
    },
    data,
  };
  await state.k8sApi.createNamespacedConfigMap(state.namespace, configMap);
}

async function updateConfigMap(
  state: RHDHDeploymentState,
  name: string,
  data: Record<string, string>,
): Promise<void> {
  if (state.isRunningLocal) {
    console.log("Skipping configmap update as isRunningLocal is true.");
    return;
  }

  const patch = [{ op: "replace", path: "/data", value: data }];
  await state.k8sApi.patchNamespacedConfigMap(
    name,
    state.namespace,
    patch,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { headers: { "Content-Type": "application/json-patch+json" } },
  );
}

export async function loadBaseConfig(state: RHDHDeploymentState): Promise<void> {
  const configPath = join(yamlsDirName, "configmap.yaml");
  const yamlContent = await fs.readFile(configPath, "utf8");
  const configData: unknown = yaml.parse(yamlContent);

  if (isRecord(configData)) {
    state.appConfig = configData;
    if (!state.isRunningLocal) {
      applyOperatorInstallProfileToAppConfig(state.appConfig, "auth-providers");
    }
  }
}

async function writeAppConfigYaml(
  state: RHDHDeploymentState,
  localLogMessage: string,
  persistRemote: (appConfigYaml: string) => Promise<void>,
): Promise<void> {
  const appConfigYaml = yaml.stringify(state.appConfig);
  if (state.isRunningLocal) {
    await writeLocalTestFile(
      join(currentDirName, "app-config.test.yaml"),
      appConfigYaml,
      localLogMessage,
    );
    return;
  }

  await persistRemote(appConfigYaml);
}

export async function createAppConfig(state: RHDHDeploymentState): Promise<void> {
  await writeAppConfigYaml(
    state,
    `App config written to ${join(currentDirName, "app-config.test.yaml")}`,
    async (appConfigYaml) => {
      await createConfigMap(state, state.appConfigMap, {
        "app-config.yaml": appConfigYaml,
      });
    },
  );
}

export async function updateAppConfig(state: RHDHDeploymentState): Promise<void> {
  await writeAppConfigYaml(
    state,
    `App config updated in ${join(currentDirName, "app-config.test.yaml")}`,
    async (appConfigYaml) => {
      await updateConfigMap(state, state.appConfigMap, {
        "app-config.yaml": appConfigYaml,
      });
    },
  );
}

export async function deleteConfigMap(state: RHDHDeploymentState): Promise<void> {
  await state.k8sApi.deleteNamespacedConfigMap(state.appConfigMap, state.namespace);
}

export async function createSecret(state: RHDHDeploymentState): Promise<void> {
  if (skipIfRunningLocal(state, "Skipping secret creation as isRunningLocal is true.")) {
    return;
  }
  const secret: k8s.V1Secret = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: state.secretName,
      namespace: state.namespace,
    },
    data: state.secretData,
  };
  try {
    await state.k8sApi.createNamespacedSecret(state.namespace, secret);
  } catch (error: unknown) {
    // Worker-restart reuse keeps the namespace; create must upsert so retries
    // do not die on AlreadyExists before enableProvider runs.
    if (isKubernetesConflictError(error)) {
      console.log(
        `[INFO] Secret ${state.secretName} already exists — replacing with current secret data`,
      );
      await updateSecret(state);
      return;
    }
    throw new Error(
      `Failed to create secret ${state.secretName}: ${getKubeApiErrorMessage(error)}`,
      { cause: error },
    );
  }
}

export async function updateSecret(state: RHDHDeploymentState): Promise<void> {
  if (skipIfRunningLocal(state, "Skipping secret update as isRunningLocal is true.")) {
    return;
  }
  // Read-merge-replace keeps resourceVersion, labels, annotations, and type so
  // replace is conditional and does not clobber operator-owned metadata.
  // Retry once on conflict — concurrent writers can invalidate resourceVersion.
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const existing = await state.k8sApi.readNamespacedSecret(state.secretName, state.namespace);
      const body = existing.body;
      body.data = state.secretData;
      await state.k8sApi.replaceNamespacedSecret(state.secretName, state.namespace, body);
      return;
    } catch (error: unknown) {
      lastError = error;
      if (attempt < 2 && isKubernetesConflictError(error)) {
        console.log(
          `[INFO] Secret ${state.secretName} replace conflict — retrying read-merge-replace`,
        );
        continue;
      }
      break;
    }
  }
  throw new Error(
    `Failed to update secret ${state.secretName}: ${getKubeApiErrorMessage(lastError)}`,
    { cause: lastError },
  );
}

export async function deleteSecret(state: RHDHDeploymentState): Promise<void> {
  if (skipIfRunningLocal(state, "Skipping secret deletion as isRunningLocal is true.")) {
    return;
  }
  await state.k8sApi.deleteNamespacedSecret(state.secretName, state.namespace);
}

export async function loadRbacConfig(state: RHDHDeploymentState): Promise<void> {
  const configPath = join(yamlsDirName, "rbac-policy.csv");
  state.rbacConfig = await fs.readFile(configPath, "utf8");
}

export async function createRbacConfig(state: RHDHDeploymentState): Promise<void> {
  if (state.isRunningLocal) {
    await writeLocalTestFile(
      join(currentDirName, "rbac.test.csv"),
      state.rbacConfig,
      `RBAC config written to ${join(currentDirName, "rbac.test.csv")}`,
    );
    return;
  }

  await createConfigMap(state, state.rbacConfigMap, {
    "rbac-policy.csv": state.rbacConfig,
  });
}

export async function updateRbacConfig(state: RHDHDeploymentState): Promise<void> {
  if (state.isRunningLocal) {
    await writeLocalTestFile(
      join(currentDirName, "rbac.test.csv"),
      state.rbacConfig,
      `RBAC config updated in ${join(currentDirName, "rbac.test.csv")}`,
    );
    return;
  }

  await updateConfigMap(state, state.rbacConfigMap, {
    "rbac-policy.csv": state.rbacConfig,
  });
}

export async function loadDynamicPluginsConfig(state: RHDHDeploymentState): Promise<void> {
  const configPath = join(yamlsDirName, "dynamic-plugins-config.yaml");
  const yamlContent = await fs.readFile(configPath, "utf8");
  const configData: unknown = yaml.parse(yamlContent);

  if (isDynamicPluginsConfig(configData)) {
    state.dynamicPluginsConfig = configData;
    applyDynamicPluginsProfile(state.dynamicPluginsConfig);
  }
}

export async function createDynamicPluginsConfig(
  state: RHDHDeploymentState,
  setAppConfigProperty: (path: string, value: unknown) => void,
  updateAppConfigFn: (state: RHDHDeploymentState) => Promise<void>,
): Promise<void> {
  if (state.isRunningLocal) {
    const dynamicPluginsConfigPath = join(currentDirName, "dynamic-plugins.test.yaml");
    const dynamicPluginsConfigYaml = yaml.stringify(state.dynamicPluginsConfig);
    await writeLocalTestFile(
      dynamicPluginsConfigPath,
      dynamicPluginsConfigYaml,
      `Dynamic plugins config written to ${dynamicPluginsConfigPath}`,
    );
    setAppConfigProperty("dynamicPlugins.rootDirectory", rootDirName + "/dynamic-plugins-root");
    await updateAppConfigFn(state);
    return;
  }

  await createConfigMap(state, state.dynamicPluginsConfigMap, {
    "dynamic-plugins.yaml": yaml.stringify(state.dynamicPluginsConfig),
  });
}

export async function updateDynamicPluginsConfig(state: RHDHDeploymentState): Promise<void> {
  const dynamicPluginsConfigYaml = yaml.stringify(state.dynamicPluginsConfig);
  if (state.isRunningLocal) {
    await writeLocalTestFile(
      join(currentDirName, "dynamic-plugins.test.yaml"),
      dynamicPluginsConfigYaml,
      `Dynamic plugins config updated in ${join(currentDirName, "dynamic-plugins.test.yaml")}`,
    );
    console.log(
      "Dynamic plugins config in dynamic-plugins.test.yaml has no effect on local deployment. Make sure to update the app-config.test.yaml file to use the dynamic-plugins-root directory and your plugin are already copied there.",
    );
    return;
  }

  await updateConfigMap(state, state.dynamicPluginsConfigMap, {
    "dynamic-plugins.yaml": dynamicPluginsConfigYaml,
  });
}

export async function loadBackstageCR(state: RHDHDeploymentState): Promise<BackstageCr> {
  const configPath = join(yamlsDirName, "backstage.yaml");
  const parsed: unknown = await readYamlToJson(configPath);
  if (!isBackstageCr(parsed)) {
    throw new Error("Invalid Backstage CR config");
  }
  const imageRegistry = process.env.IMAGE_REGISTRY ?? "quay.io";
  const imageRepo = process.env.IMAGE_REPO ?? process.env.QUAY_REPO ?? undefined;
  const tagName = process.env.TAG_NAME;
  expect(imageRepo, "IMAGE_REPO or QUAY_REPO must be set").toBeTruthy();
  expect(tagName, "TAG_NAME must be set").toBeTruthy();
  const image = `${imageRegistry}/${imageRepo}:${tagName}`;
  parsed.spec.deployment = {
    patch: {
      spec: {
        template: {
          spec: {
            containers: [
              {
                name: "backstage-backend",
                image,
                imagePullPolicy: "Always",
              },
            ],
          },
        },
      },
    },
  };
  console.log(`Setting Backstage CR image via deployment.patch to ${image}`);
  applyOperatorInstallProfileToCr(parsed);
  state.cr = parsed;
  state.instanceName = parsed.metadata.name;
  return parsed;
}

export async function applyCustomResource(
  state: RHDHDeploymentState,
  resource: BackstageCr,
): Promise<void> {
  console.log("Applying CR.");
  try {
    const customObjectsApi = state.kc.makeApiClient(k8s.CustomObjectsApi);
    await customObjectsApi.createNamespacedCustomObject(
      resource.apiVersion.split("/")[0],
      resource.apiVersion.split("/")[1],
      state.namespace,
      resource.kind.toLowerCase() + "s",
      resource,
    );
  } catch (e) {
    console.error(JSON.stringify(e));
    throw e;
  }
}

function startLocalBackstageProcess(state: RHDHDeploymentState): void {
  state.runningProcess = spawn(
    "yarn",
    [
      "dev",
      "--env-mode=loose",
      "--",
      "--config",
      currentDirName + "/app-config.test.yaml",
      "--config",
      currentDirName + "/dynamic-plugins.test.yaml",
    ],
    {
      shell: true,
      cwd: resolvePath(rootDirName),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    },
  );
  state.runningProcess.unref();
  console.log(`Local production server started with PID: ${state.runningProcess.pid}`);
}

export async function createBackstageDeployment(
  state: RHDHDeploymentState,
  options: { waitForReady?: boolean } = {},
): Promise<void> {
  const waitForReady = options.waitForReady ?? true;
  try {
    if (state.isRunningLocal) {
      startLocalBackstageProcess(state);
      return;
    }
    await ensureBackstageCRIsAvailable(state, 60000);
    const backstageConfig = await loadBackstageCR(state);
    await applyCustomResource(state, backstageConfig);
    if (waitForReady) {
      await waitForDeploymentReady(state);
    }
  } catch (e) {
    console.log(JSON.stringify(e));
    throw e;
  }
}

export async function killRunningProcess(
  state: RHDHDeploymentState,
  getBackstageUrl: () => Promise<string>,
): Promise<void> {
  const processPid = state.runningProcess?.pid;
  if (processPid === undefined || processPid === 0) {
    console.log("No running process to kill.");
    return;
  }

  const killed = process.kill(-processPid);
  console.log("Local production server process killed?", killed);

  await new Promise<void>((resolvePromise) => {
    state.runningProcess?.once("exit", () => {
      resolvePromise();
    });
  });
  state.runningProcess = null;

  const baseUrl = await getBackstageUrl();
  await pollUntil(
    async () => {
      try {
        const response = await fetch(baseUrl, { method: "HEAD" });
        return response.status !== 200;
      } catch {
        return true;
      }
    },
    {
      timeoutMs: 30_000,
      intervalMs: 500,
      label: "Homepage should become inaccessible after process termination",
    },
  );
  console.log("Homepage is not accessible as expected after process termination.");
}

export function computeBackstageUrl(state: RHDHDeploymentState): string {
  if (state.isRunningLocal) {
    return "http://localhost:3000";
  }
  const cluster = state.kc.getCurrentCluster();
  if (cluster?.server === undefined || cluster.server === "") {
    throw new Error("Unable to retrieve cluster information.");
  }
  const regex = /^https?:\/\/(?:api\.)?([^:/]+)/u;
  const match = cluster.server.match(regex);
  const clusterBaseUrl = match?.[1] ?? "";
  if (clusterBaseUrl === "") {
    console.log("No match found.");
  }
  // Auth providers always deploy via the operator.
  return predictedUrl({
    installMethod: "operator",
    releaseName: state.instanceName,
    namespace: state.namespace,
    routerBase: `apps.${clusterBaseUrl}`,
  });
}

export function computeBackstageBackendUrl(state: RHDHDeploymentState): string {
  if (state.isRunningLocal) {
    return "http://localhost:7007";
  }
  return computeBackstageUrl(state);
}
