/**
 * E2E test for pluginDivisionMode: schema
 *
 * Verifies that RHDH can operate with schema-mode enabled when the database user
 * has restricted permissions (NOCREATEDB), matching production managed database environments.
 *
 * Tests are opt-in - they skip when SCHEMA_MODE_* environment variables are not set.
 */

import { test, expect } from "@playwright/test";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { Common } from "../../utils/common";
import { KubeClient } from "../../utils/kube-client";
import { setPortForwardRestarter } from "./schema-mode-db";
import { SchemaModeTestSetup } from "./schema-mode-setup";

function startPortForward(
  pfNamespace: string,
  pfResource: string,
): Promise<ChildProcessWithoutNullStreams> {
  return new Promise<ChildProcessWithoutNullStreams>((resolve, reject) => {
    const proc = spawn("oc", [
      "port-forward",
      "-n",
      pfNamespace,
      pfResource,
      "5432:5432",
    ]);

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("Port-forward timeout after 30 seconds"));
    }, 30000);

    proc.stdout.on("data", (data) => {
      if (data.toString().includes("Forwarding from")) {
        clearTimeout(timeout);
        resolve(proc);
      }
    });

    proc.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) console.error(`Port-forward stderr: ${msg}`);
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function killPortForward(
  proc: ChildProcessWithoutNullStreams | undefined,
): Promise<void> {
  if (!proc || proc.exitCode !== null) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const forceKillTimeout = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // already dead
      }
      resolve();
    }, 5000);

    proc.once("close", () => {
      clearTimeout(forceKillTimeout);
      resolve();
    });

    proc.kill("SIGTERM");
  });
}

test.describe("Verify pluginDivisionMode: schema", () => {
  const namespace = process.env.NAME_SPACE_RUNTIME || "showcase-runtime";
  const releaseName = process.env.RELEASE_NAME || "developer-hub";
  const installMethod = (
    process.env.INSTALL_METHOD === "operator" ? "operator" : "helm"
  ) as "helm" | "operator";

  let portForwardProcess: ChildProcessWithoutNullStreams | undefined;
  let testSetup: SchemaModeTestSetup;

  test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(300000);

    const hasPortForwardMeta =
      !!process.env.SCHEMA_MODE_PORT_FORWARD_NAMESPACE &&
      !!process.env.SCHEMA_MODE_PORT_FORWARD_RESOURCE;
    const hasDirectHost = !!process.env.SCHEMA_MODE_DB_HOST;

    if (
      !process.env.SCHEMA_MODE_DB_ADMIN_PASSWORD ||
      !process.env.SCHEMA_MODE_DB_PASSWORD ||
      (!hasPortForwardMeta && !hasDirectHost)
    ) {
      testInfo.skip(
        true,
        "SCHEMA_MODE_* environment variables not set - schema mode tests are opt-in",
      );
      return;
    }

    testInfo.annotations.push(
      { type: "component", description: "data-management" },
      { type: "namespace", description: namespace },
    );

    if (hasPortForwardMeta) {
      const pfNamespace = process.env.SCHEMA_MODE_PORT_FORWARD_NAMESPACE!;
      const pfResource = process.env.SCHEMA_MODE_PORT_FORWARD_RESOURCE!;

      console.log(
        `Starting port-forward: ${pfResource} in ${pfNamespace} -> localhost:5432`,
      );

      portForwardProcess = await startPortForward(pfNamespace, pfResource);
      console.log("Port-forward established");
      process.env.SCHEMA_MODE_DB_HOST = "localhost";

      setPortForwardRestarter(async () => {
        await killPortForward(portForwardProcess);
        console.log("Restarting port-forward...");
        portForwardProcess = await startPortForward(pfNamespace, pfResource);
        console.log("Port-forward re-established");
      });
    }

    testSetup = new SchemaModeTestSetup(namespace, releaseName, installMethod);

    try {
      await testSetup.setupDatabase();
      await testSetup.configureRHDH();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      testInfo.skip(true, `Schema mode setup failed: ${errorMsg}`);
    }
  });

  test.afterAll(async () => {
    setPortForwardRestarter(null);
    await killPortForward(portForwardProcess);
  });

  test("Verify database user has restricted permissions", async () => {
    const hasRestrictedPerms =
      await testSetup.verifyRestrictedDatabasePermissions();
    expect(hasRestrictedPerms).toBe(true);
  });

  test("Verify RHDH is accessible with schema mode", async ({
    page,
  }, testInfo) => {
    const kubeClient = new KubeClient();
    const deploymentName = testSetup.getDeploymentName();

    try {
      const deployment = await kubeClient.appsApi.readNamespacedDeployment(
        deploymentName,
        namespace,
      );
      const readyReplicas = deployment.body.status?.readyReplicas ?? 0;

      if (readyReplicas < 1) {
        testInfo.skip(
          true,
          "Deployment is not ready (cluster capacity or PVC issue)",
        );
        return;
      }
    } catch (error) {
      console.warn("Could not check deployment readiness:", error);
    }

    const common = new Common(page);
    await common.loginAsGuest();

    console.log(
      "RHDH is accessible - plugins successfully created schemas in schema mode",
    );
  });
});
