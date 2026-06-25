import { ChildProcess } from "child_process";
import { resolve as resolvePath } from "path";

import { GroupEntity, UserEntity } from "@backstage/catalog-model";
import * as k8s from "@kubernetes/client-node";

export type YamlConfig = Record<string, unknown>;

export interface DynamicPluginConfig {
  package: string;
  disabled?: boolean;
}

export type DynamicPluginsConfig = Record<string, unknown> & {
  plugins: DynamicPluginConfig[];
};

export interface BackstageCrSpec {
  replicas?: number;
  deployment?: unknown;
}

export interface BackstageCr {
  apiVersion: string;
  kind: string;
  metadata: { name: string };
  spec: BackstageCrSpec;
}

export interface RHDHDeploymentState {
  instanceName: string;
  kc: k8s.KubeConfig;
  k8sApi: k8s.CoreV1Api;
  appsV1Api: k8s.AppsV1Api;
  namespace: string;
  appConfigMap: string;
  rbacConfigMap: string;
  dynamicPluginsConfigMap: string;
  secretName: string;
  appConfig: YamlConfig;
  dynamicPluginsConfig: DynamicPluginsConfig;
  rbacConfig: string;
  secretData: Record<string, string>;
  isRunningLocal: boolean;
  runningProcess: ChildProcess | null;
  staticToken: string;
  cr: BackstageCr;
  configReconcileBaselineGeneration: number | undefined;
}

export { sleep } from "../../poll-until";

export function isRecord(value: unknown): value is YamlConfig {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isBackstageCr(value: unknown): value is BackstageCr {
  return (
    isRecord(value) &&
    typeof value.apiVersion === "string" &&
    typeof value.kind === "string" &&
    isRecord(value.metadata) &&
    typeof value.metadata.name === "string" &&
    isRecord(value.spec)
  );
}

export function isDynamicPluginsConfig(value: unknown): value is DynamicPluginsConfig {
  if (!isRecord(value)) {
    return false;
  }
  const { plugins } = value;
  return (
    plugins === undefined ||
    (Array.isArray(plugins) &&
      plugins.every((plugin) => isRecord(plugin) && typeof plugin.package === "string"))
  );
}

export function isUserEntity(value: unknown): value is UserEntity {
  return isRecord(value) && value.kind === "User";
}

export function isGroupEntity(value: unknown): value is GroupEntity {
  return isRecord(value) && value.kind === "Group";
}

export function getCatalogUsers(response: unknown): UserEntity[] {
  if (!isRecord(response) || !Array.isArray(response.items)) {
    return [];
  }
  return response.items.filter(isUserEntity);
}

export function getCatalogGroups(response: unknown): GroupEntity[] {
  if (!isRecord(response) || !Array.isArray(response.items)) {
    return [];
  }
  return response.items.filter(isGroupEntity);
}

export const currentDirName = import.meta.dirname;
export const rootDirName = resolvePath(currentDirName, "..", "..", "..", "..");

export const syncedLogRegex =
  /(Committed \d+ (Keycloak|msgraph|GitHub|LDAP|GitLab) users? and \d+ (Keycloak|msgraph|GitHub|LDAP|GitLab) groups? in \d+(\.\d+)? seconds|Scanned \d+ users? and processed \d+ users?)/u;

export function isRunningLocalMode(): boolean {
  return process.env.ISRUNNINGLOCAL === "true";
}

export function shouldUseKubernetesClient(): boolean {
  const isRunningLocalEnv = process.env.ISRUNNINGLOCAL;
  return isRunningLocalEnv === undefined || isRunningLocalEnv === "false";
}
