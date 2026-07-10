import { describe, expect, it, vi } from "vitest";

import { tryGetDeploymentGeneration } from "../playwright/utils/authentication-providers/rhdh-deployment/wait";

function mockState(items: Array<{ metadata?: { generation?: number } }>) {
  return {
    instanceName: "rhdh",
    namespace: "showcase-auth-providers",
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
