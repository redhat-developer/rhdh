import { KubeClient } from "./kube-client";
import type { RuntimeDeployConfig } from "./runtime-config";
import { deployRuntime } from "./runtime-deploy";
import { stopRuntimeApplication, runtimeRevision } from "./runtime-lifecycle";

/** Run a storage assertion with no application writers, then restore a fresh revision. */
export async function restartRuntime(
  kube: KubeClient,
  config: RuntimeDeployConfig,
  method: "helm" | "operator",
  whileStopped?: () => Promise<void>,
): Promise<void> {
  await stopRuntimeApplication(kube, config.namespace, config.releaseName, method);
  const errors: unknown[] = [];
  try {
    await whileStopped?.();
  } catch (error) {
    errors.push(error);
  }
  try {
    if (config.cloudSql) config.cloudSql.revision = runtimeRevision();
    else config.revision = runtimeRevision();
    await deployRuntime(config, method, kube);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Runtime probe and restart failed");
}
