import { LOGGER } from "./logger";
import { spawn } from "child_process";
import * as constants from "./authenticationProviders/constants";
import { expect } from "@playwright/test";
import { KubeClient } from "./kube-client";
import { V1ConfigMap, V1Secret } from "@kubernetes/client-node";
import { GroupEntity } from "@backstage/catalog-model";
import fs from "fs";
import { APIHelper } from "./api-helper";

export async function runShellCmd(command: string, timeout?: number) {
  return new Promise<string>((resolve, reject) => {
    const process = spawn("/bin/sh", ["-c", command]);
    let result: string = "";
    let timeoutHandle: NodeJS.Timeout | undefined;

    if (timeout && timeout > 0) {
      timeoutHandle = setTimeout(() => {
        process.kill("SIGTERM");
        reject(`Process timed out after ${timeout} ms`);
      }, timeout);
    }

    process.stdout.on("data", (data) => {
      result += data.toString();
    });

    process.stderr.on("data", (data) => {
      result += data.toString();
    });

    process.on("exit", (code) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      result += "";
      if (code === 0) {
        resolve(result);
      } else {
        LOGGER.info(`Process failed with code ${code}: ${result}`);
        reject(`Process failed with code ${code}: ${result}`);
      }
    });

    process.on("error", (err) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      reject(`Process execution failed: ${err.message}`);
    });
  });
}

export async function upgradeHelmChartWithWait(
  release: string,
  chart: string,
  namespace: string,
  value: string,
  chartVersion: string,
  quayRepo: string,
  tag: string,
  flags: Array<string>,
) {
  LOGGER.info(`Deleting any exisitng helm release ${release}`);
  await deleteHelmReleaseWithWait(release, namespace);

  LOGGER.info(`Upgrading helm release ${release}`);
  const upgradeCMD = `helm upgrade \
    -i ${release} ${chart}  \
    --wait --timeout 300s -n ${namespace} \
    --values ${value} \
    --version "${chartVersion}" --set upstream.backstage.image.repository="${quayRepo}" --set upstream.backstage.image.tag="${tag}" \
    --set global.clusterRouterBase=${process.env.K8S_CLUSTER_ROUTER_BASE}  \
    ${flags.join(" ")}`;
  LOGGER.info(`Running upgrade with command ${upgradeCMD}`);

  const upgradeOutput = await runShellCmd(upgradeCMD);

  LOGGER.log({
    level: "info",
    message: `Release upgrade returned: `,
    dump: upgradeOutput.toString(),
  });

  const configmap = await new KubeClient().getConfigMap(
    `${release}-backstage-app-config`,
    namespace,
  );
  LOGGER.log({
    level: "info",
    message: `Applied confguration for release upgrade: `,
    dump: configmap.body.data,
  });

  //TBD: get dynamic plugins configmap
}

export async function deleteHelmReleaseWithWait(
  release: string,
  namespace: string,
) {
  LOGGER.info(`Deleting release ${release} in namespace ${namespace}`);
  const result = await runShellCmd(
    `helm uninstall ${release} --wait --timeout 300s -n ${namespace} || true`,
  );
  LOGGER.log({
    level: "info",
    message: `Release delete returned: `,
    dump: result.toString(),
  });
  return result.toString();
}

export async function getLastSyncTimeFromLogs(
  provider: string,
): Promise<number> {
  let searchString = "Reading msgraph users and groups";
  if (provider == "microsoft") {
    searchString = "Reading msgraph users and groups";
  } else if (provider == "rhsso") {
    searchString = "Reading Keycloak users and groups";
  } else if (provider == "github") {
    searchString = "Reading GitHub users and groups";
  }

  try {
    // TBD: change this to use kube api
    const p = await new KubeClient().coreV1Api.listNamespacedPod(
      constants.AUTH_PROVIDERS_NAMESPACE,
      undefined,
      undefined,
      undefined,
      undefined,
      "app.kubernetes.io/component=backstage",
    );
    const pods = p.body.items.map((pod) => pod.metadata.name);

    const log = await runShellCmd(
      `oc logs ${pods[0].trim()} -n ${constants.AUTH_PROVIDERS_NAMESPACE} -c backstage-backend | grep "${searchString}" | tail -n1`,
    );
    const syncObj = Date.parse(JSON.parse(log).timestamp);
    return syncObj;
  } catch (e) {
    LOGGER.error(JSON.stringify(e));
    return null;
  }
}

export async function waitForNextSync(provider: string, synTimeOut: number) {
  let syncTime: number | null = null;
  await expect(async () => {
    const nextSyncTime = await getLastSyncTimeFromLogs(provider);
    if (syncTime == null) {
      syncTime = nextSyncTime;
    }
    LOGGER.info(
      `Last registered sync time was: ${new Date(syncTime).toUTCString()}(${syncTime}); last detected in logs:${new Date(nextSyncTime).toUTCString()}(${nextSyncTime})`,
    );
    expect(nextSyncTime).not.toBeNull();
    expect(nextSyncTime).toBeGreaterThan(syncTime);
  }).toPass({
    intervals: [1_000, 2_000, 10_000],
    timeout: synTimeOut * 2 * 1000,
  });
}

export async function replaceInRBACPolicyFileConfigMap(
  configMap: string,
  namespace: string,
  match: RegExp | string,
  value: string,
) {
  LOGGER.info(
    `Replacing ${match} with ${value} in existing configmap ${configMap} in namespace ${namespace}`,
  );
  const cm = await ensureNewPolicyConfigMapExists(configMap, namespace);
  const patched = cm.body.data["rbac-policy.csv"].replace(match, value);
  LOGGER.info(`Patch ${patched}`);
  const patch = [
    {
      op: "replace",
      path: "/data",
      value: {
        "rbac-policy.csv": patched,
      },
    },
  ];
  await new KubeClient().updateConfigMap(configMap, namespace, patch);
}

export async function ensureNewPolicyConfigMapExists(
  configMap: string,
  namespace: string,
) {
  const kubeCLient = new KubeClient();
  try {
    LOGGER.info(
      `Ensuring configmap ${configMap} exisists in namespace ${namespace}`,
    );
    await kubeCLient.getConfigMap(configMap, namespace);
    const patch = [
      {
        op: "replace",
        path: "/data",
        value: {
          "rbac-policy.csv": constants.RBAC_POLICY_ROLES,
        },
      },
    ];
    await kubeCLient.updateConfigMap(configMap, namespace, patch);
    return await kubeCLient.getConfigMap(configMap, namespace);
  } catch (e) {
    if (e.response.statusCode == 404) {
      LOGGER.info(
        `Configmap ${configMap} did not exist in namespace ${namespace}. Creating it..`,
      );
      const cmBody: V1ConfigMap = {
        metadata: {
          name: configMap,
          namespace: namespace,
        },
        data: {
          "rbac-policy.csv": constants.RBAC_POLICY_ROLES,
        },
      };
      return await kubeCLient.createCongifmap(namespace, cmBody);
    } else {
      throw e;
    }
  }
}

export async function ensureEnvSecretExists(
  secretName: string,
  namespace: string,
) {
  const kubeCLient = new KubeClient();
  LOGGER.info(`Ensuring secret ${secretName} exists in namespace ${namespace}`);
  const secretData = {
    BASE_URL: Buffer.from(process.env.BASE_URL).toString("base64"),
    AUTH_PROVIDERS_AZURE_CLIENT_SECRET: Buffer.from(
      constants.AUTH_PROVIDERS_AZURE_CLIENT_SECRET,
    ).toString("base64"),
    AUTH_PROVIDERS_AZURE_CLIENT_ID: Buffer.from(
      constants.AUTH_PROVIDERS_AZURE_CLIENT_ID,
    ).toString("base64"),
    AUTH_PROVIDERS_AZURE_TENANT_ID: Buffer.from(
      constants.AUTH_PROVIDERS_AZURE_TENANT_ID,
    ).toString("base64"),
    AUTH_PROVIDERS_REALM_NAME: Buffer.from(
      constants.AUTH_PROVIDERS_REALM_NAME,
    ).toString("base64"),
    AZURE_LOGIN_USERNAME: Buffer.from(constants.AZURE_LOGIN_USERNAME).toString(
      "base64",
    ),
    AZURE_LOGIN_PASSWORD: Buffer.from(constants.AZURE_LOGIN_PASSWORD).toString(
      "base64",
    ),
    RHSSO76_DEFAULT_PASSWORD: Buffer.from(
      constants.RHSSO76_DEFAULT_PASSWORD,
    ).toString("base64"),
    RHSSO76_METADATA_URL: Buffer.from(
      `${constants.RHSSO76_URL}/realms/authProviders`,
    ).toString("base64"),
    RHSSO76_URL: Buffer.from(constants.RHSSO76_URL).toString("base64"),
    RHSSO76_CLIENT_ID: Buffer.from(constants.RHSSO76_CLIENTID).toString(
      "base64",
    ),
    RHSSO76_ADMIN_USERNAME: Buffer.from(
      constants.RHSSO76_ADMIN_USERNAME,
    ).toString("base64"),
    RHSSO76_ADMIN_PASSWORD: Buffer.from(
      constants.RHSSO76_ADMIN_PASSWORD,
    ).toString("base64"),
    RHSSO76_CALLBACK_URL: Buffer.from(
      `${process.env.BASE_URL}/api/auth/oidc/handler/frame`,
    ).toString("base64"),
    RHSSO76_CLIENT_SECRET: Buffer.from(
      constants.RHSSO76_CLIENT_SECRET,
    ).toString("base64"),

    RHBK_DEFAULT_PASSWORD: Buffer.from(
      constants.RHSSO76_DEFAULT_PASSWORD,
    ).toString("base64"),
    RHBK_METADATA_URL: Buffer.from(
      `${constants.RHBK_URL}/realms/authProviders`,
    ).toString("base64"),
    RHBK_CLIENT_ID: Buffer.from(constants.RHBK_CLIENTID).toString("base64"),
    RHBK_ADMIN_USERNAME: Buffer.from(constants.RHBK_ADMIN_USERNAME).toString(
      "base64",
    ),
    RHBK_ADMIN_PASSWORD: Buffer.from(constants.RHBK_ADMIN_PASSWORD).toString(
      "base64",
    ),
    RHBK_CALLBACK_URL: Buffer.from(
      `${process.env.BASE_URL}/api/auth/oidc/handler/frame`,
    ).toString("base64"),
    RHBK_CLIENT_SECRET: Buffer.from(constants.RHBK_CLIENT_SECRET).toString(
      "base64",
    ),
    RHBK_URL: Buffer.from(constants.RHBK_URL).toString("base64"),

    AUTH_ORG_APP_ID: Buffer.from(constants.AUTH_ORG_APP_ID).toString("base64"),
    AUTH_ORG_CLIENT_ID: Buffer.from(constants.AUTH_ORG_CLIENT_ID).toString(
      "base64",
    ),
    AUTH_ORG_CLIENT_SECRET: Buffer.from(
      constants.AUTH_ORG_CLIENT_SECRET,
    ).toString("base64"),
    AUTH_ORG1_PRIVATE_KEY: Buffer.from(
      constants.AUTH_ORG1_PRIVATE_KEY,
    ).toString("base64"),
    AUTH_ORG_WEBHOOK_SECRET: Buffer.from(
      constants.AUTH_ORG_WEBHOOK_SECRET,
    ).toString("base64"),
    AUTH_PROVIDERS_GH_ORG_NAME: Buffer.from(
      constants.AUTH_PROVIDERS_GH_ORG_NAME,
    ).toString("base64"),
    GH_USER_PASSWORD: Buffer.from(constants.GH_USER_PASSWORD).toString(
      "base64",
    ),
    AUTH_PROVIDERS_GH_USER_2FA: Buffer.from(
      constants.AUTH_PROVIDERS_GH_USER_2FA,
    ).toString("base64"),
    AUTH_PROVIDERS_GH_ADMIN_2FA: Buffer.from(
      constants.AUTH_PROVIDERS_GH_ADMIN_2FA,
    ).toString("base64"),
  };
  const secret: V1Secret = {
    metadata: {
      name: secretName,
    },
    data: secretData,
  };
  try {
    await kubeCLient.getSecret(secretName, namespace);
    const patch = {
      data: secretData,
    };
    await kubeCLient.updateSecret(secretName, namespace, patch);
    return await kubeCLient.getSecret(secretName, namespace);
  } catch (e) {
    if (e.response.statusCode == 404) {
      LOGGER.info(
        `Secret ${secretName} did not exist yet in namespace ${namespace}. Creating it..`,
      );
      await kubeCLient.createSecret(secret, namespace);
    } else {
      throw e;
    }
  }
}

export function parseGroupMemberFromEntity(group: GroupEntity) {
  if (!group.relations) {
    return [];
  }
  return group.relations
    .filter((r) => {
      if (r.type == "hasMember") {
        return true;
      }
    })
    .map((r) => r.targetRef.split("/")[1]);
}

export function parseGroupChildrenFromEntity(group: GroupEntity) {
  if (!group.relations) {
    return [];
  }
  return group.relations
    .filter((r) => {
      if (r.type == "parentOf") {
        return true;
      }
    })
    .map((r) => r.targetRef.split("/")[1]);
}

export function parseGroupParentFromEntity(group: GroupEntity) {
  if (!group.relations) {
    return [];
  }
  return group.relations
    .filter((r) => {
      if (r.type == "childOf") {
        return true;
      }
    })
    .map((r) => r.targetRef.split("/")[1]);
}

export async function dumpAllPodsLogs(filePrefix?: string, folder?: string) {
  const prefix = filePrefix ? filePrefix : "";
  const folderString = folder ? folder : "/tmp";
  const p = await new KubeClient().coreV1Api.listNamespacedPod(
    constants.AUTH_PROVIDERS_NAMESPACE,
    undefined,
    undefined,
    undefined,
    undefined,
    "app.kubernetes.io/component=backstage",
  );
  const pods = p.body.items;

  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }

  for (const pod of pods) {
    const backstageBackendLogs =
      await new KubeClient().coreV1Api.readNamespacedPodLog(
        pod.metadata.name,
        pod.metadata.namespace,
        "backstage-backend",
      );
    const dynamicPluginsLogs =
      await new KubeClient().coreV1Api.readNamespacedPodLog(
        pod.metadata.name,
        pod.metadata.namespace,
        "install-dynamic-plugins",
      );
    fs.writeFileSync(
      `${folderString}/${prefix}-backend.txt`,
      backstageBackendLogs.body,
      { flag: "w" },
    );
    fs.writeFileSync(
      `${folderString}/${prefix}-init.txt`,
      dynamicPluginsLogs.body,
      { flag: "w" },
    );
  }
}

export async function dumpRHDHUsersAndGroups(
  filePrefix?: string,
  folder?: string,
) {
  const prefix = filePrefix ? filePrefix : "";
  const folderString = folder ? folder : "/tmp";
  const api = new APIHelper();
  api.UseStaticToken(constants.STATIC_API_TOKEN);
  const users = await api.getAllCatalogUsersFromAPI();
  const groups = await api.getAllCatalogGroupsFromAPI();
  const locations = await api.getAllCatalogLocationsFromAPI();

  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }

  fs.writeFileSync(
    `${folderString}/${prefix}-catalog.txt`,
    JSON.stringify({ users, groups, locations }),
    { flag: "w" },
  );
}
