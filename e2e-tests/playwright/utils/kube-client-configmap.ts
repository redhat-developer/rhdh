import * as k8s from "@kubernetes/client-node";
import * as yaml from "js-yaml";
import { hasErrorResponse } from "./errors";
import {
  APP_CONFIG_NAMES,
  getKubeApiErrorMessage,
  isRecord,
} from "./kube-client-helpers";

function hasAppConfigDataKey(data: Record<string, string>): boolean {
  return Object.keys(data).some(
    (key) => key.includes("app-config") && key.endsWith(".yaml"),
  );
}

function resolveAppConfigDataKey(
  actualConfigMapName: string,
  dataKeys: string[],
): string | undefined {
  const keyPatterns = [
    `${actualConfigMapName}.yaml`,
    ...APP_CONFIG_NAMES.map((name) => `${name}.yaml`),
  ];

  for (const pattern of keyPatterns) {
    if (dataKeys.includes(pattern)) {
      return pattern;
    }
  }

  return (
    dataKeys.find(
      (key) => key.endsWith(".yaml") && key.includes("app-config"),
    ) ?? dataKeys.find((key) => key.endsWith(".yaml"))
  );
}

export async function findAppConfigMapName(
  coreV1Api: k8s.CoreV1Api,
  listConfigMaps: (
    namespace: string,
  ) => Promise<{ body: { items: k8s.V1ConfigMap[] } }>,
  namespace: string,
): Promise<string> {
  try {
    const configMapsResponse = await listConfigMaps(namespace);
    const configMaps = configMapsResponse.body.items;

    console.log(
      `Found ${configMaps.length} ConfigMaps in namespace ${namespace}`,
    );
    configMaps.forEach((cm) => {
      console.log(`ConfigMap: ${cm.metadata?.name}`);
    });

    for (const name of APP_CONFIG_NAMES) {
      const found = configMaps.find((cm) => cm.metadata?.name === name);
      if (found !== undefined) {
        console.log(`Found app config ConfigMap: ${name}`);
        return name;
      }
    }

    for (const cm of configMaps) {
      if (cm.data !== undefined && hasAppConfigDataKey(cm.data)) {
        const configMapName = cm.metadata?.name ?? "";
        console.log(`Found ConfigMap with app-config data: ${configMapName}`);
        return configMapName;
      }
    }

    throw new Error(
      `No suitable app-config ConfigMap found in namespace ${namespace}`,
    );
  } catch (error) {
    console.error(
      `Error finding app config ConfigMap: ${getKubeApiErrorMessage(error)}`,
    );
    throw error;
  }
}

async function resolveConfigMapName(
  coreV1Api: k8s.CoreV1Api,
  configMapName: string,
  namespace: string,
  findAppConfigMap: (namespace: string) => Promise<string>,
): Promise<string> {
  try {
    await coreV1Api.readNamespacedConfigMap(configMapName, namespace);
    console.log(`Using provided ConfigMap name: ${configMapName}`);
    return configMapName;
  } catch (error) {
    if (hasErrorResponse(error) && error.response?.statusCode === 404) {
      console.log(
        `ConfigMap ${configMapName} not found, searching for alternatives...`,
      );
      return findAppConfigMap(namespace);
    }
    throw error;
  }
}

function applyTitleToConfigMap(
  configMap: k8s.V1ConfigMap,
  actualConfigMapName: string,
  dataKey: string,
  newTitle: string,
): void {
  if (configMap.data === undefined) {
    throw new Error(`ConfigMap '${actualConfigMapName}' has no data section`);
  }

  const appConfigYaml = configMap.data[dataKey];
  if (appConfigYaml === undefined || appConfigYaml === "") {
    throw new Error(
      `Data key '${dataKey}' is empty in ConfigMap '${actualConfigMapName}'`,
    );
  }

  const parsedConfig: unknown = yaml.load(appConfigYaml);
  if (!isRecord(parsedConfig) || !isRecord(parsedConfig.app)) {
    throw new Error(
      `Invalid app-config structure in ConfigMap '${actualConfigMapName}'. Expected 'app' section not found.`,
    );
  }

  const appSection = parsedConfig.app;
  const currentTitle =
    typeof appSection.title === "string" ? appSection.title : undefined;
  console.log(`Current title: ${currentTitle ?? "(none)"}`);
  appSection.title = newTitle;
  console.log(`New title: ${newTitle}`);

  configMap.data[dataKey] = yaml.dump(parsedConfig);

  if (configMap.metadata !== undefined) {
    delete configMap.metadata.creationTimestamp;
    delete configMap.metadata.resourceVersion;
  }
}

export async function updateConfigMapTitleImpl(
  coreV1Api: k8s.CoreV1Api,
  getConfigMap: (
    configmapName: string,
    namespace: string,
  ) => Promise<{ body: k8s.V1ConfigMap }>,
  findAppConfigMap: (namespace: string) => Promise<string>,
  configMapName: string,
  namespace: string,
  newTitle: string,
): Promise<void> {
  try {
    const actualConfigMapName = await resolveConfigMapName(
      coreV1Api,
      configMapName,
      namespace,
      findAppConfigMap,
    );

    const configMapResponse = await getConfigMap(
      actualConfigMapName,
      namespace,
    );
    const configMap = configMapResponse.body;

    console.log(`Using ConfigMap: ${actualConfigMapName}`);
    console.log(
      `Available data keys: ${Object.keys(configMap.data ?? {}).join(", ")}`,
    );

    const dataKeys = Object.keys(configMap.data ?? {});
    const dataKey = resolveAppConfigDataKey(actualConfigMapName, dataKeys);

    if (dataKey === undefined) {
      throw new Error(
        `No suitable YAML data key found in ConfigMap '${actualConfigMapName}'. Available keys: ${dataKeys.join(", ")}`,
      );
    }

    console.log(`Using data key: ${dataKey}`);
    applyTitleToConfigMap(configMap, actualConfigMapName, dataKey, newTitle);

    await coreV1Api.replaceNamespacedConfigMap(
      actualConfigMapName,
      namespace,
      configMap,
    );
    console.log(
      `ConfigMap '${actualConfigMapName}' updated successfully with new title: '${newTitle}'`,
    );
  } catch (error) {
    console.error(`Error updating ConfigMap: ${getKubeApiErrorMessage(error)}`);
    throw new Error(
      `Failed to update ConfigMap: ${getKubeApiErrorMessage(error)}`,
      { cause: error },
    );
  }
}
