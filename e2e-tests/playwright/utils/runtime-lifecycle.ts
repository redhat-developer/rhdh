import { randomBytes } from "node:crypto";

import type { TestInfo } from "@playwright/test";

import { resolveInstallMethod, run } from "./helper";
import { KubeClient, getErrorStatusCode, getRhdhDeploymentName, isRecord } from "./kube-client";
import { pollUntil } from "./poll-until";

const ownerLabel = "rhdh.redhat.com/runtime-run";
const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

export async function deleteOwnedRuntimeNamespace(
  kube: KubeClient,
  namespace: string,
  runId: string,
  labelKey = ownerLabel,
): Promise<void> {
  try {
    const existing = await kube.coreV1Api.readNamespace(namespace);
    if (existing.body.metadata?.labels?.[labelKey] !== runId)
      throw new Error(`Refusing to delete unowned namespace ${namespace}`);
    await kube.coreV1Api.deleteNamespace(namespace);
  } catch (error) {
    if (getErrorStatusCode(error) === 404) return;
    throw error;
  }
  await pollUntil(
    async () => {
      try {
        await kube.coreV1Api.readNamespace(namespace);
        return false;
      } catch (error) {
        if (getErrorStatusCode(error) === 404) return true;
        throw error;
      }
    },
    { timeoutMs: 180_000, intervalMs: 2_000, label: `Delete runtime namespace ${namespace}` },
  );
}

export async function resetRuntimeNamespace(
  kube: KubeClient,
  namespace: string,
  runId: string,
  labelKey = ownerLabel,
): Promise<void> {
  await deleteOwnedRuntimeNamespace(kube, namespace, runId, labelKey);
  await kube.coreV1Api.createNamespace({
    metadata: { name: namespace, labels: { [labelKey]: runId } },
  });
}

/** Change the owner, never fight an Operator by patching its generated Deployment. */
async function setRuntimeReplicas(
  kube: KubeClient,
  namespace: string,
  releaseName: string,
  method: "helm" | "operator",
  replicas: number,
): Promise<void> {
  if (method === "helm") {
    await kube.scaleDeployment(getRhdhDeploymentName(method, releaseName), namespace, replicas);
    return;
  }
  await patchRuntimeCR(kube, namespace, releaseName, {
    spec: { deployment: { patch: { spec: { replicas } } } },
  });
}

/** Patch desired fields only; controller status updates cannot cause resourceVersion conflicts. */
export async function patchRuntimeCR(
  kube: KubeClient,
  namespace: string,
  releaseName: string,
  patch: object,
): Promise<void> {
  await kube.customObjectsApi.patchNamespacedCustomObject(
    "rhdh.redhat.com",
    "v1alpha5",
    namespace,
    "backstages",
    releaseName,
    patch,
    undefined,
    undefined,
    undefined,
    { headers: { "Content-Type": "application/merge-patch+json" } },
  );
}

/** Stop all writers and installers before mutating their configuration or data. */
export async function stopRuntimeApplication(
  kube: KubeClient,
  namespace: string,
  releaseName = process.env.RELEASE_NAME ?? "rhdh",
  method = resolveInstallMethod(),
): Promise<void> {
  const deploymentName = getRhdhDeploymentName(method, releaseName);
  await setRuntimeReplicas(kube, namespace, releaseName, method, 0);
  await pollUntil(
    async () => {
      const { body } = await kube.appsApi.readNamespacedDeployment(deploymentName, namespace);
      const pods = await kube.coreV1Api.listNamespacedPod(namespace);
      return (
        body.spec?.replicas === 0 &&
        (body.status?.observedGeneration ?? 0) >= (body.metadata?.generation ?? 1) &&
        (body.status?.replicas ?? 0) === 0 &&
        !pods.body.items.some(
          (pod) => pod.metadata?.name?.startsWith(`${deploymentName}-`) === true,
        )
      );
    },
    {
      timeoutMs: 180_000,
      intervalMs: 2_000,
      label: `Stop ${deploymentName} before runtime mutation`,
    },
  );
}

export async function waitForRuntimeRollout(
  kube: KubeClient,
  namespace: string,
  deploymentName: string,
): Promise<void> {
  await pollUntil(
    async () => {
      const { body } = await kube.appsApi.readNamespacedDeployment(deploymentName, namespace);
      const desired = body.spec?.replicas ?? 1;
      return (
        desired > 0 &&
        (body.status?.observedGeneration ?? 0) >= (body.metadata?.generation ?? 1) &&
        body.status?.updatedReplicas === desired &&
        body.status.readyReplicas === desired &&
        body.status.availableReplicas === desired &&
        body.status.replicas === desired
      );
    },
    { timeoutMs: 600_000, intervalMs: 2_000, label: `Current runtime rollout ${deploymentName}` },
  );
}

/** ConfigMap/Secret changes have already been applied while the application is stopped. */
export async function resumeRuntimeApplication(
  kube: KubeClient,
  namespace: string,
  releaseName = process.env.RELEASE_NAME ?? "rhdh",
  method = resolveInstallMethod(),
): Promise<void> {
  await setRuntimeReplicas(kube, namespace, releaseName, method, 1);
  await waitForRuntimeRollout(kube, namespace, getRhdhDeploymentName(method, releaseName));
}

export async function setRuntimeDatabaseEnv(
  kube: KubeClient,
  namespace: string,
  releaseName: string,
  method: "helm" | "operator",
  secretName: string,
  keys: readonly string[],
): Promise<void> {
  if (method === "helm") {
    await kube.addContainerEnvVarsFromSecret(
      getRhdhDeploymentName(method, releaseName),
      namespace,
      "backstage-backend",
      secretName,
      [...keys],
    );
    return;
  }
  const response = await kube.customObjectsApi.getNamespacedCustomObject(
    "rhdh.redhat.com",
    "v1alpha5",
    namespace,
    "backstages",
    releaseName,
  );
  if (!isRecord(response.body)) throw new Error("Backstage CR missing");
  const cr = response.body;
  const spec = record(cr.spec);
  const deployment = record(spec.deployment);
  const patch = record(deployment.patch);
  const patchSpec = record(patch.spec);
  const template = record(patchSpec.template);
  const pod = record(template.spec);
  const containers = Array.isArray(pod.containers)
    ? pod.containers.map((item: unknown) => record(item))
    : [];
  const backend = containers.find((container) => container.name === "backstage-backend");
  if (backend === undefined) throw new Error("Runtime CR lacks backstage-backend patch");
  const env = Array.isArray(backend.env) ? backend.env.map((item: unknown) => record(item)) : [];
  backend.env = [
    ...env.filter((item) => typeof item.name === "string" && !keys.includes(item.name)),
    ...keys.map((name) => ({ name, valueFrom: { secretKeyRef: { name: secretName, key: name } } })),
  ];
  await patchRuntimeCR(kube, namespace, releaseName, {
    spec: { deployment: { patch: { spec: { template: { spec: { containers } } } } } },
  });
}

export async function deleteRuntimeApplication(
  kube: KubeClient,
  namespace: string,
  releaseName: string,
  method: "helm" | "operator",
): Promise<void> {
  if (method === "helm") {
    await run(
      "helm",
      ["uninstall", releaseName, "-n", namespace, "--ignore-not-found", "--wait", "--timeout=3m"],
      { timeout: 210_000 },
    );
  } else {
    await run(
      "oc",
      [
        "delete",
        `backstages.rhdh.redhat.com/${releaseName}`,
        "-n",
        namespace,
        "--ignore-not-found",
        "--cascade=foreground",
        "--wait=true",
        "--timeout=180s",
      ],
      { timeout: 210_000 },
    );
  }
  const name = getRhdhDeploymentName(method, releaseName);
  await run(
    "oc",
    [
      "delete",
      `deployment/${name}`,
      "-n",
      namespace,
      "--ignore-not-found",
      "--cascade=foreground",
      "--wait=true",
      "--timeout=180s",
    ],
    { timeout: 210_000 },
  );
  await pollUntil(
    async () => {
      const pods = await kube.coreV1Api.listNamespacedPod(namespace);
      return !pods.body.items.some((pod) => pod.metadata?.name?.startsWith(`${name}-`) === true);
    },
    { timeoutMs: 180_000, intervalMs: 2_000, label: `Delete runtime application ${name}` },
  );
}

export function runtimeRevision(): string {
  return randomBytes(8).toString("hex");
}

/** Collect before teardown; never include Secret resources or credential values. */
export async function collectRuntimeDiagnostics(
  kube: KubeClient,
  namespace: string,
  info: Pick<TestInfo, "attach">,
  redact: (text: string) => string,
): Promise<void> {
  const attach = async (name: string, action: () => Promise<unknown>) => {
    try {
      const result = await action();
      await info.attach(name, {
        body: redact(typeof result === "string" ? result : JSON.stringify(result, null, 2)),
        contentType: "text/plain",
      });
    } catch (error) {
      console.warn(`Runtime diagnostic ${name} unavailable: ${redact(String(error))}`);
    }
  };
  await attach(
    "runtime-deployments",
    async () => (await kube.appsApi.listNamespacedDeployment(namespace)).body,
  );
  await attach(
    "runtime-events",
    async () => (await kube.coreV1Api.listNamespacedEvent(namespace)).body,
  );
  await attach(
    "runtime-pods",
    async () => (await kube.coreV1Api.listNamespacedPod(namespace)).body,
  );
  try {
    const pods = await kube.coreV1Api.listNamespacedPod(namespace);
    for (const pod of pods.body.items) {
      const name = pod.metadata?.name;
      if (name === undefined) continue;
      for (const container of [
        ...(pod.spec?.initContainers ?? []),
        ...(pod.spec?.containers ?? []),
      ]) {
        await attach(`${name}-${container.name}`, () =>
          run("oc", ["logs", "-n", namespace, name, "-c", container.name, "--tail=500"], {
            timeout: 30_000,
          }),
        );
      }
    }
  } catch (error) {
    console.warn(`Runtime pod logs unavailable: ${redact(String(error))}`);
  }
}
