import { describe, expect, it, vi } from "vitest";

import { waitForDeploymentReadiness } from "../playwright/utils/deployment-readiness";

describe("waitForDeploymentReadiness", () => {
  it("runs Available → HTTP → synced in order when all stages are requested", async () => {
    const order: string[] = [];
    await waitForDeploymentReadiness(["available", "http", "synced"], {
      waitForAvailable: () => {
        order.push("available");
        return Promise.resolve();
      },
      waitForHttpReady: () => {
        order.push("http");
        return Promise.resolve();
      },
      waitForSynced: () => {
        order.push("synced");
        return Promise.resolve();
      },
    });

    expect(order).toEqual(["available", "http", "synced"]);
  });

  it("skips stages that were not requested", async () => {
    const waitForSynced = vi.fn<() => Promise<void>>().mockResolvedValue();
    await waitForDeploymentReadiness(["available", "http"], {
      waitForAvailable: () => Promise.resolve(),
      waitForHttpReady: () => Promise.resolve(),
      waitForSynced,
    });

    expect(waitForSynced).not.toHaveBeenCalled();
  });

  it("always respects stage order even if callers pass stages out of order", async () => {
    const order: string[] = [];
    await waitForDeploymentReadiness(["synced", "available"], {
      waitForAvailable: () => {
        order.push("available");
        return Promise.resolve();
      },
      waitForHttpReady: () => {
        order.push("http");
        return Promise.resolve();
      },
      waitForSynced: () => {
        order.push("synced");
        return Promise.resolve();
      },
    });

    expect(order).toEqual(["available", "synced"]);
  });
});
