import { IncomingMessage } from "node:http";
import { Socket } from "node:net";

import type { V1Deployment } from "@kubernetes/client-node";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KubeClient } from "../playwright/utils/kube-client";
import {
  stopRuntimeApplication,
  waitForRuntimeRollout,
  setRuntimeDatabaseEnv,
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
    vi.spyOn(kube.customObjectsApi, "getNamespacedCustomObject").mockResolvedValue(
      response({ spec: { deployment: { patch: { spec: {} } } } }),
    );
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
  it("keeps database credential references under Operator ownership", async () => {
    const kube = kubeClient();
    vi.spyOn(kube.customObjectsApi, "getNamespacedCustomObject").mockResolvedValue(
      response({
        spec: {
          deployment: {
            patch: {
              spec: {
                template: {
                  spec: {
                    containers: [
                      {
                        name: "backstage-backend",
                        image: "image",
                        env: [{ name: "NODE_OPTIONS", value: "keep" }],
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      }),
    );
    const replace = vi
      .spyOn(kube.customObjectsApi, "patchNamespacedCustomObject")
      .mockResolvedValue(response({}));
    await setRuntimeDatabaseEnv(kube, "runtime", "rhdh", "operator", "runtime-schema-credentials", [
      "POSTGRES_USER",
    ]);
    expect(replace.mock.calls[0][5]).toMatchObject({
      spec: {
        deployment: {
          patch: {
            spec: {
              template: {
                spec: {
                  containers: [
                    {
                      name: "backstage-backend",
                      image: "image",
                      env: [
                        { name: "NODE_OPTIONS", value: "keep" },
                        {
                          name: "POSTGRES_USER",
                          valueFrom: {
                            secretKeyRef: {
                              name: "runtime-schema-credentials",
                              key: "POSTGRES_USER",
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      },
    });
  });
});
