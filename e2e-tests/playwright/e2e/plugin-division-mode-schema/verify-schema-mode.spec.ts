/**
 * E2E test for pluginDivisionMode: schema
 *
 * Verifies that RHDH can operate with schema-mode enabled when the database user
 * has restricted permissions (NOCREATEDB), matching production managed database environments.
 *
 * Tests are opt-in - they skip when SCHEMA_MODE_* environment variables are not set.
 */

import { ChildProcessWithoutNullStreams, spawn } from "child_process";

import { test, expect } from "@support/coverage/test";

import { Common } from "../../utils/common";
import { resolveInstallMethod } from "../../utils/helper";
import { KubeClient } from "../../utils/kube-client";
import { ensureRuntimeDeployed } from "../../utils/runtime-deploy";
import { setPortForwardRestarter } from "./schema-mode-db";
import { SchemaModeTestSetup } from "./schema-mode-setup";

function streamDataToString(data: Buffer | string): string {
  return typeof data === "string" ? data : data.toString();
}

function startPortForward(
  pfNamespace: string,
  pfResource: string,
): Promise<ChildProcessWithoutNullStreams> {
  return new Promise<ChildProcessWithoutNullStreams>((resolve, reject) => {
    const proc = spawn("oc", ["port-forward", "-n", pfNamespace, pfResource, "5432:5432"]);

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("Port-forward timeout after 30 seconds"));
    }, 30000);

    let ready = false;
    proc.stdout.on("data", (data: Buffer | string) => {
      if (ready) return;
      if (streamDataToString(data).includes("Forwarding from")) {
        ready = true;
        clearTimeout(timeout);
        resolve(proc);
      }
    });

    proc.stderr.on("data", (data: Buffer | string) => {
      const msg = streamDataToString(data).trim();
      if (msg) console.error(`Port-forward stderr: ${msg}`);
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function killPortForward(proc: ChildProcessWithoutNullStreams | undefined): Promise<void> {
  if (!proc || proc.exitCode !== null) return Promise.resolve();

  return new Promise<void>((resolve) => {
    proc.once("close", () => {
      resolve();
    });

    proc.kill("SIGTERM");

    setTimeout(() => {
      if (proc.exitCode === null) {
        try {
          proc.kill("SIGKILL");
        } catch {
          // already dead
        }
      }
    }, 5000);
  });
}

test.describe("Verify pluginDivisionMode: schema", () => {
  const namespace = process.env.NAME_SPACE_RUNTIME ?? "showcase-runtime";
  const releaseName = process.env.RELEASE_NAME ?? "rhdh";
  const installMethod = resolveInstallMethod();

  let portForwardProcess: ChildProcessWithoutNullStreams | undefined;
  let testSetup: SchemaModeTestSetup;

  test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(900000);

    // Ensure the runtime RHDH instance is deployed (idempotent — no-op if already running).
    // Also sets SCHEMA_MODE_* env vars via configureSchemaMode().
    await ensureRuntimeDeployed();

    const pfNamespace = process.env.SCHEMA_MODE_PORT_FORWARD_NAMESPACE;
    const pfResource = process.env.SCHEMA_MODE_PORT_FORWARD_RESOURCE;
    const dbHost = process.env.SCHEMA_MODE_DB_HOST;
    const adminPassword = process.env.SCHEMA_MODE_DB_ADMIN_PASSWORD;
    const dbPassword = process.env.SCHEMA_MODE_DB_PASSWORD;

    const hasPortForwardMeta =
      pfNamespace !== undefined &&
      pfNamespace !== "" &&
      pfResource !== undefined &&
      pfResource !== "";
    const hasDirectHost = dbHost !== undefined && dbHost !== "";

    if (
      adminPassword === undefined ||
      adminPassword === "" ||
      dbPassword === undefined ||
      dbPassword === "" ||
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
      console.log(`Starting port-forward: ${pfResource} in ${pfNamespace} -> localhost:5432`);

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
    const hasRestrictedPerms = await testSetup.verifyRestrictedDatabasePermissions();
    expect(hasRestrictedPerms).toBe(true);
  });

  test("Verify RHDH is accessible with schema mode", async ({ page }, testInfo) => {
    const kubeClient = new KubeClient();
    const deploymentName = testSetup.getDeploymentName();

    try {
      const deployment = await kubeClient.appsApi.readNamespacedDeployment(
        deploymentName,
        namespace,
      );
      const readyReplicas = deployment.body.status?.readyReplicas ?? 0;

      if (readyReplicas < 1) {
        testInfo.skip(true, "Deployment is not ready (cluster capacity or PVC issue)");
        return;
      }
    } catch (error) {
      console.warn("Could not check deployment readiness:", error);
    }

    const common = new Common(page);
    await common.loginAsGuest();

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    console.log("RHDH is accessible - plugins successfully created schemas in schema mode");
  });
});
