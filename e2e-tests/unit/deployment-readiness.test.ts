import { describe, expect, it, vi } from "vitest";

import { waitForDeploymentReadiness } from "../playwright/utils/deployment-readiness";

describe("waitForDeploymentReadiness", () => {
  it("runs created → HTTP → synced in order when all stages are requested", async () => {
    const order: string[] = [];
    await waitForDeploymentReadiness(["created", "http", "synced"], {
      waitForCreated: () => {
        order.push("created");
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

    expect(order).toEqual(["created", "http", "synced"]);
  });

  it("skips stages that were not requested", async () => {
    const waitForSynced = vi.fn<() => Promise<void>>().mockResolvedValue();
    await waitForDeploymentReadiness(["created", "http"], {
      waitForCreated: () => Promise.resolve(),
      waitForHttpReady: () => Promise.resolve(),
      waitForSynced,
    });

    expect(waitForSynced).not.toHaveBeenCalled();
  });

  it("always respects stage order even if callers pass stages out of order", async () => {
    const order: string[] = [];
    await waitForDeploymentReadiness(["synced", "created"], {
      waitForCreated: () => {
        order.push("created");
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

    expect(order).toEqual(["created", "synced"]);
  });
});
