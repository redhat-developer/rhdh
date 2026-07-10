import { describe, expect, it, vi } from "vitest";

import {
  tryGetDeploymentGeneration,
  waitForDeploymentCreated,
} from "../playwright/utils/authentication-providers/rhdh-deployment/wait";

function mockState(items: Array<{ metadata?: { generation?: number } }>) {
  return {
    instanceName: "rhdh",
    namespace: "showcase-auth-providers",
    isRunningLocal: false,
    appsV1Api: {
      listNamespacedDeployment: vi
        .fn<() => Promise<{ body: { items: typeof items } }>>()
        .mockResolvedValue({ body: { items } }),
    },
  };
}

describe("tryGetDeploymentGeneration", () => {
  it("returns undefined when the Backstage deployment does not exist yet", async () => {
    await expect(tryGetDeploymentGeneration(mockState([]))).resolves.toBeUndefined();
  });

  it("returns the deployment generation when present", async () => {
    await expect(
      tryGetDeploymentGeneration(mockState([{ metadata: { generation: 3 } }])),
    ).resolves.toBe(3);
  });
});

describe("waitForDeploymentCreated", () => {
  it("resolves once the labeled Deployment appears", async () => {
    const listNamespacedDeployment = vi
      .fn<() => Promise<{ body: { items: Array<{ metadata?: { generation?: number } }> } }>>()
      .mockResolvedValueOnce({ body: { items: [] } })
      .mockResolvedValueOnce({ body: { items: [{ metadata: { generation: 1 } }] } });

    await waitForDeploymentCreated(
      {
        instanceName: "rhdh",
        namespace: "showcase-auth-providers",
        isRunningLocal: false,
        appsV1Api: { listNamespacedDeployment },
      },
      5_000,
    );

    expect(listNamespacedDeployment.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
