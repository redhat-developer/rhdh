import { expect, test } from "@support/coverage/test";
import Redis from "ioredis";

import { PortForwardHarness } from "../support/harnesses/port-forward-harness";
import { TechDocsPage } from "../support/pages/techdocs-page";

const REDIS_LOCAL_PORT = 16_379;

test.describe("Verify Redis Cache DB", () => {
  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
  });

  let techDocsPage: TechDocsPage;
  let portForward: PortForwardHarness | null = null;
  let redis: Redis;

  test.beforeAll(async () => {
    const namespace = process.env.NAME_SPACE;
    if (!namespace) {
      throw new Error("NAME_SPACE must be set for redis port-forward");
    }

    console.log("Starting port-forward process...");
    // Direct kubectl args (CI already logged in). Avoid shell wrappers so stop()
    // can tear down the port-forward cleanly between multi-phase Playwright runs.
    portForward = new PortForwardHarness(
      {
        command: "kubectl",
        args: [
          "port-forward",
          `service/redis`,
          `${REDIS_LOCAL_PORT}:6379`,
          `--namespace=${namespace}`,
        ],
      },
      {
        readyPattern: /Forwarding from/u,
        readyTimeoutMs: 60_000,
      },
    );
    console.log("Waiting for port-forward to be ready...");
    try {
      await portForward.start();
    } catch (error) {
      await portForward.stop();
      throw error;
    }
  });

  test.beforeEach(({ guestPage }) => {
    techDocsPage = new TechDocsPage(guestPage);
  });

  test("Open techdoc and verify the cache generated in redis db", async () => {
    await techDocsPage.openDocFromFavorites("Red Hat Developer Hub");

    // ensure that the docs are generated. if redis configuration has an error, this page will hang and docs won't be generated
    await expect(async () => {
      await techDocsPage.verifyDocHeading("rhdh");
    }).toPass({
      intervals: [3_000],
      timeout: 60_000,
    });

    console.log("Connecting to Redis...");
    redis = new Redis(
      `redis://${process.env.REDIS_USERNAME}:${process.env.REDIS_PASSWORD}@localhost:${REDIS_LOCAL_PORT}`,
    );
    console.log("Verifying Redis keys...");
    await expect(async () => {
      const keys = (await redis.keys("*")).filter((k) => k.includes("techdocs"));
      expect(keys).toContainEqual(expect.stringContaining("techdocs"));
      const key = keys[0];
      console.log(`Verifying key format: ${key}`);
      expect(key).toMatch(/(?:techdocs):(?:[A-Za-z0-9+/]+={0,2})$/gmu);
    }).toPass({
      intervals: [3_000],
      timeout: 60_000,
    });
  });

  test.afterEach(() => {
    if (redis?.status === "ready") {
      redis.disconnect();
    }
  });

  test.afterAll(async () => {
    await portForward?.stop();
  });
});
