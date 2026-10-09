import { IncomingMessage } from "node:http";
import { Socket } from "node:net";

import type { V1Deployment } from "@kubernetes/client-node";
import type { TestInfo } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KubeClient } from "../playwright/utils/kube-client";
import {
  stopRuntimeApplication,
  waitForRuntimeRollout,
  deleteOwnedRuntimeNamespace,
  collectRuntimeDiagnostics,
} from "../playwright/utils/runtime-lifecycle";

function kubeClient(): KubeClient {
  vi.stubEnv("K8S_CLUSTER_URL", "https://cluster.example.test");
  vi.stubEnv("K8S_CLUSTER_TOKEN", "fake");
  return new KubeClient();
}
function response<T>(body: T) {
  return { response: new IncomingMessage(new Socket()), body };
}
function deployment(observedGeneration: number, replicas = 1): V1Deployment {
  return {
    metadata: { generation: 2 },
    spec: { replicas, selector: { matchLabels: { app: "rhdh" } }, template: {} },
    status: {
      observedGeneration,
      replicas,
      updatedReplicas: replicas,
      readyReplicas: replicas,
      availableReplicas: replicas,
    },
  };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("owned runtime teardown", () => {
  it.each(["rhdh.redhat.com/runtime-run", "rhdh.redhat.com/cloudsql-run"])(
    "refuses namespace deletion when %s belongs to another run",
    async (labelKey) => {
      const kube = kubeClient();
      vi.spyOn(kube.coreV1Api, "readNamespace").mockResolvedValue(
        response({ metadata: { labels: { [labelKey]: "another-run" } } }),
      );
      const remove = vi.spyOn(kube.coreV1Api, "deleteNamespace");
      await expect(
        deleteOwnedRuntimeNamespace(kube, "runtime", "012345abcdef", labelKey),
      ).rejects.toThrow("Refusing to delete unowned namespace");
      expect(remove).not.toHaveBeenCalled();
    },
  );
  it("keeps failed diagnostic pod lookups non-fatal and redacts credentials", async () => {
    const kube = kubeClient();
    vi.spyOn(kube.appsApi, "listNamespacedDeployment").mockResolvedValue(response({ items: [] }));
    vi.spyOn(kube.coreV1Api, "listNamespacedEvent").mockResolvedValue(response({ items: [] }));
    vi.spyOn(kube.coreV1Api, "listNamespacedPod").mockRejectedValue(
      new Error("unavailable with fake-password and fake-api-token"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = {
      attach: vi.fn<TestInfo["attach"]>().mockImplementation(() => Promise.resolve()),
    };
    await expect(
      collectRuntimeDiagnostics(kube, "runtime", info, (text) =>
        text.replaceAll("fake-password", "[REDACTED]").replaceAll("fake-api-token", "[REDACTED]"),
      ),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Runtime pod logs unavailable"));
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/fake-password|fake-api-token/u);
  });
});

describe("ordered runtime lifecycle", () => {
  it("rejects readiness from an old observed generation", async () => {
    vi.useFakeTimers();
    const kube = kubeClient();
    const read = vi
      .spyOn(kube.appsApi, "readNamespacedDeployment")
      .mockResolvedValueOnce(response(deployment(1)))
      .mockResolvedValue(response(deployment(2)));
    const ready = waitForRuntimeRollout(kube, "runtime", "backstage-rhdh");
    await vi.advanceTimersByTimeAsync(2_000);
    await ready;
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("stops through the CR and waits for initializing/terminating pods to disappear", async () => {
    vi.useFakeTimers();
    const kube = kubeClient();
    const replace = vi
      .spyOn(kube.customObjectsApi, "patchNamespacedCustomObject")
      .mockResolvedValue(response({}));
    const scale = vi.spyOn(kube, "scaleDeployment");
    vi.spyOn(kube.appsApi, "readNamespacedDeployment").mockResolvedValue(
      response(deployment(2, 0)),
    );
    vi.spyOn(kube.coreV1Api, "listNamespacedPod")
      .mockResolvedValueOnce(response({ items: [{ metadata: { name: "backstage-rhdh-old" } }] }))
      .mockResolvedValue(response({ items: [] }));
    const stop = stopRuntimeApplication(kube, "runtime", "rhdh", "operator");
    await vi.advanceTimersByTimeAsync(2_000);
    await stop;
    expect(scale).not.toHaveBeenCalled();
    expect(replace.mock.calls[0][5]).toMatchObject({
      spec: { deployment: { patch: { spec: { replicas: 0 } } } },
    });
  });
});
