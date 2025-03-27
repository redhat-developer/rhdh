import { expect, test } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { Common } from "../utils/common";
import Redis from "ioredis";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";

test.describe("Verify Redis Cache DB", () => {
  test.describe.configure({ mode: "serial" });
  let common: Common;
  let uiHelper: UIhelper;
  let portForward: ChildProcessWithoutNullStreams;
  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    await common.loginAsGuest();

    console.log("Starting port-forward process...");
    portForward = spawn("/bin/sh", [
      "-c",
      `
      oc login --token="${process.env.K8S_CLUSTER_TOKEN}" --server="${process.env.K8S_CLUSTER_URL}" --insecure-skip-tls-verify=true &&
      kubectl config set-context --current --namespace="${process.env.NAME_SPACE}" &&
      kubectl port-forward service/redis 6379:6379 --namespace="${process.env.NAME_SPACE}" & pid=$!
      trap '{
        kill $pid
      }' SIGINT
    `,
    ]);

    console.log("Waiting for port-forward to be ready...");
    await new Promise<void>((resolve, reject) => {
      portForward.stdout.on("data", (data) => {
        if (data.toString().includes("Forwarding from 127.0.0.1:6379")) {
          resolve();
        }
      });

      portForward.stderr.on("data", (data) => {
        console.error(`Port forwarding failed: ${data.toString()}`);
        reject(new Error(`Port forwarding failed: ${data.toString()}`));
      });
    });
  });

  test("Open techdoc and verify the cache generated in redis db", async () => {
    test.setTimeout(120_000);

    await uiHelper.openSidebarButton("Favorites");
    await uiHelper.openSidebar("Docs");
    await uiHelper.clickLink("Backstage Showcase");

    // ensure that the docs are generated. if redis configuration has an error, this page will hang and docs won't be generated
    await expect(async () => {
      await uiHelper.verifyHeading("rhdh");
    }).toPass({
      intervals: [3_000],
      timeout: 60_000,
    });

    console.log("Connecting to Redis...");
    const redis = new Redis(
      `redis://${process.env.REDIS_USERNAME}:${process.env.REDIS_PASSWORD}@localhost:6379`,
    );
    console.log("Verifying Redis keys...");
    await expect(async () => {
      const keys = await redis.keys("*");
      console.log(`Redis keys: ${keys}`);
      expect(keys).toContainEqual(
        expect.stringContaining("techdocs").or.stringContaining("bulk-import"),
      );

      const key = keys.filter((k) => k.startsWith("techdocs"))[0];
      console.log(`Verifying key format: ${key}`);
      expect(key).toMatch(
        /(?:techdocs|bulk-import):(?:[A-Za-z0-9+]{4})*(?:[A-Za-z0-9+]{2}==|[A-Za-z0-9+]{3}=)$/gm,
      );
    }).toPass({
      intervals: [3_000],
      timeout: 60_000,
    });
  });

  test.afterEach(() => {
    console.log("Killing port-forward process...");
    portForward.kill("SIGINT");
  });
});
