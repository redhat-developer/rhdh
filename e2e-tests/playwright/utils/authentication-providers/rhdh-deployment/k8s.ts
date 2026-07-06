import { spawn } from "child_process";
import { promises as fs } from "fs";
import { join, resolve as resolvePath } from "path";

import * as k8s from "@kubernetes/client-node";
import { expect } from "@playwright/test";
import * as yaml from "yaml";

import { hasErrorResponse } from "../../errors";
import { sleep } from "../../poll-until";
import {
  BackstageCr,
  currentDirName,
  isBackstageCr,
  isDynamicPluginsConfig,
  isRecord,
  RHDHDeploymentState,
  rootDirName,
} from "./types";
import { ensureBackstageCRIsAvailable, waitForDeploymentReady } from "./wait";

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
    if (hasErrorResponse(e) && e.response?.statusCode === 409) {
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
  const configPath = join(currentDirName, "yamls", "configmap.yaml");
  const yamlContent = await fs.readFile(configPath, "utf8");
  const configData: unknown = yaml.parse(yamlContent);

  if (isRecord(configData)) {
    state.appConfig = configData;
  }
}

export async function createAppConfig(state: RHDHDeploymentState): Promise<void> {
  if (state.isRunningLocal) {
    const appConfigPath = join(currentDirName, "app-config.test.yaml");
    const appConfigYaml = yaml.stringify(state.appConfig);
    await fs.writeFile(appConfigPath, appConfigYaml, "utf8");
    console.log(`App config written to ${appConfigPath}`);
    return;
  }

  await createConfigMap(state, state.appConfigMap, {
    "app-config.yaml": yaml.stringify(state.appConfig),
  });
}

export async function updateAppConfig(state: RHDHDeploymentState): Promise<void> {
  if (state.isRunningLocal) {
    const appConfigPath = join(currentDirName, "app-config.test.yaml");
    const appConfigYaml = yaml.stringify(state.appConfig);
    await fs.writeFile(appConfigPath, appConfigYaml, "utf8");
    console.log(`App config updated in ${appConfigPath}`);
    return;
  }

  await updateConfigMap(state, state.appConfigMap, {
    "app-config.yaml": yaml.stringify(state.appConfig),
  });
}

export async function deleteConfigMap(state: RHDHDeploymentState): Promise<void> {
  await state.k8sApi.deleteNamespacedConfigMap(state.appConfigMap, state.namespace);
}

export async function createSecret(state: RHDHDeploymentState): Promise<void> {
  if (state.isRunningLocal) {
    console.log("Skipping secret creation as isRunningLocal is true.");
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
  await state.k8sApi.createNamespacedSecret(state.namespace, secret);
}

export async function updateSecret(state: RHDHDeploymentState): Promise<void> {
  if (state.isRunningLocal) {
    console.log("Skipping secret update as isRunningLocal is true.");
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
  await state.k8sApi.replaceNamespacedSecret(state.secretName, state.namespace, secret);
}

export async function deleteSecret(state: RHDHDeploymentState): Promise<void> {
  if (state.isRunningLocal) {
    console.log("Skipping secret deletion as isRunningLocal is true.");
    return;
  }
  await state.k8sApi.deleteNamespacedSecret(state.secretName, state.namespace);
}

export async function loadRbacConfig(state: RHDHDeploymentState): Promise<void> {
  const configPath = join(currentDirName, "yamls", "rbac-policy.csv");
  state.rbacConfig = await fs.readFile(configPath, "utf8");
}

export async function createRbacConfig(state: RHDHDeploymentState): Promise<void> {
  if (state.isRunningLocal) {
    const rbacConfigPath = join(currentDirName, "rbac.test.csv");
    await fs.writeFile(rbacConfigPath, state.rbacConfig, "utf8");
    console.log(`RBAC config written to ${rbacConfigPath}`);
    return;
  }

  await createConfigMap(state, state.rbacConfigMap, {
    "rbac-policy.csv": state.rbacConfig,
  });
}

export async function updateRbacConfig(state: RHDHDeploymentState): Promise<void> {
  if (state.isRunningLocal) {
    const rbacConfigPath = join(currentDirName, "rbac.test.csv");
    await fs.writeFile(rbacConfigPath, state.rbacConfig, "utf8");
    console.log(`RBAC config updated in ${rbacConfigPath}`);
    return;
  }

  await updateConfigMap(state, state.rbacConfigMap, {
    "rbac-policy.csv": state.rbacConfig,
  });
}

export async function loadDynamicPluginsConfig(state: RHDHDeploymentState): Promise<void> {
  const configPath = join(currentDirName, "yamls", "dynamic-plugins-config.yaml");
  const yamlContent = await fs.readFile(configPath, "utf8");
  const configData: unknown = yaml.parse(yamlContent);

  if (isDynamicPluginsConfig(configData)) {
    state.dynamicPluginsConfig = configData;
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
    await fs.writeFile(dynamicPluginsConfigPath, dynamicPluginsConfigYaml, "utf8");
    console.log(`Dynamic plugins config written to ${dynamicPluginsConfigPath}`);
    setAppConfigProperty("dynamicPlugins.rootDirectory", rootDirName + "/dynamic-plugins-root");
    await updateAppConfigFn(state);
    return;
  }

  await createConfigMap(state, state.dynamicPluginsConfigMap, {
    "dynamic-plugins.yaml": yaml.stringify(state.dynamicPluginsConfig),
  });
}

export async function updateDynamicPluginsConfig(state: RHDHDeploymentState): Promise<void> {
  if (state.isRunningLocal) {
    const dynamicPluginsConfigPath = join(currentDirName, "dynamic-plugins.test.yaml");
    const dynamicPluginsConfigYaml = yaml.stringify(state.dynamicPluginsConfig);
    await fs.writeFile(dynamicPluginsConfigPath, dynamicPluginsConfigYaml, "utf8");
    console.log(`Dynamic plugins config updated in ${dynamicPluginsConfigPath}`);
    console.log(
      "Dynamic plugins config in dynamic-plugins.test.yaml has no effect on local deployment. Make sure to update the app-config.test.yaml file to use the dynamic-plugins-root directory and your plugin are already copied there.",
    );
    return;
  }

  await updateConfigMap(state, state.dynamicPluginsConfigMap, {
    "dynamic-plugins.yaml": yaml.stringify(state.dynamicPluginsConfig),
  });
}

export async function loadBackstageCR(state: RHDHDeploymentState): Promise<BackstageCr> {
  const configPath = join(currentDirName, "yamls", "backstage.yaml");
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

export async function createBackstageDeployment(state: RHDHDeploymentState): Promise<void> {
  try {
    if (state.isRunningLocal) {
      startLocalBackstageProcess(state);
      return;
    }
    await ensureBackstageCRIsAvailable(state, 60000);
    const backstageConfig = await loadBackstageCR(state);
    await applyCustomResource(state, backstageConfig);
    await waitForDeploymentReady(state);
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
  await sleep(5000);
  console.log("Process termination buffer elapsed.");
  state.runningProcess = null;

  const baseUrl = await getBackstageUrl();
  try {
    const response = await fetch(baseUrl, { method: "HEAD" });
    if (response.status === 200) {
      throw new Error("Homepage is still accessible after process termination");
    }
  } catch (error) {
    console.log("Homepage is not accessible as expected: ", error);
  }
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
  return `https://backstage-${state.instanceName}-${state.namespace}.apps.${clusterBaseUrl}`;
}

export function computeBackstageBackendUrl(state: RHDHDeploymentState): string {
  if (state.isRunningLocal) {
    return "http://localhost:7007";
  }
  return computeBackstageUrl(state);
}
