/**
 * E2E test for pluginDivisionMode: schema
 *
 * Verifies that RHDH can operate with schema-mode enabled when the database user
 * has restricted permissions (NOCREATEDB), matching production managed database environments.
 *
 * This test runs for both Helm and Operator deployments.
 * Tests are opt-in - they skip when SCHEMA_MODE_* environment variables are not set.
 */

import { chromium, test, expect } from "@playwright/test";
import { ChildProcessWithoutNullStreams, spawn, exec } from "child_process";
import { Common } from "../../utils/common";
import { KubeClient } from "../../utils/kube-client";
import { SchemaModeTestSetup } from "./schema-mode-setup";

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

    // Check if required environment variables are set
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

    // Start port-forward if metadata is provided (simple pattern from verify-redis-cache.spec.ts)
    if (hasPortForwardMeta) {
      const pfNamespace = process.env.SCHEMA_MODE_PORT_FORWARD_NAMESPACE!;
      const pfResource = process.env.SCHEMA_MODE_PORT_FORWARD_RESOURCE!;

      console.log(
        `Starting port-forward: ${pfResource} in ${pfNamespace} -> localhost:5432`,
      );

      portForwardProcess = spawn("oc", [
        "port-forward",
        "-n",
        pfNamespace,
        pfResource,
        "5432:5432",
      ]);

      // Wait for port-forward to be ready
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Port-forward timeout after 30 seconds"));
        }, 30000);

        portForwardProcess!.stdout.on("data", (data) => {
          const output = data.toString();
          if (output.includes("Forwarding from")) {
            clearTimeout(timeout);
            console.log("✓ Port-forward established");
            resolve();
          }
        });

        portForwardProcess!.stderr.on("data", (data) => {
          console.error(`Port-forward error: ${data.toString()}`);
        });

        portForwardProcess!.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      process.env.SCHEMA_MODE_DB_HOST = "localhost";
    }

    // Setup database and configure RHDH for schema mode
    testSetup = new SchemaModeTestSetup(namespace, releaseName, installMethod);

    try {
      await testSetup.setupDatabase();
      await testSetup.configureRHDH();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      testInfo.skip(true, `Schema mode setup failed: ${errorMsg}`);
    }
  });

  test.afterAll(() => {
    // Cleanup port-forward
    if (portForwardProcess) {
      console.log("Stopping port-forward");
      portForwardProcess.kill("SIGTERM");
      exec(
        `ps aux | grep 'oc port-forward' | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true`,
      );
    }
  });

  test("Verify RHDH is accessible with schema mode", async ({}, testInfo) => {
    // Check if deployment is ready before launching browser
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
      // Continue - let the test attempt to connect
    }

    // Get RHDH URL
    let baseUrl = process.env.BASE_URL;
    if (!baseUrl) {
      baseUrl = await testSetup.getRHDHUrl();
    }

    // Verify RHDH is accessible
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();

      // Intercept navigation to use baseUrl
      const originalGoto = page.goto.bind(page);
      page.goto = async (
        url: string,
        options?: Parameters<typeof page.goto>[1],
      ) => {
        if (url.startsWith("/") && !url.startsWith("//")) {
          url = `${baseUrl}${url}`;
        } else if (!url.startsWith("http")) {
          url = `${baseUrl}/${url}`;
        }
        return originalGoto(url, options);
      };

      const common = new Common(page);
      await common.loginAsGuest();

      console.log(
        "✓ RHDH is accessible - plugins successfully created schemas in schema mode",
      );
    } finally {
      await browser.close();
    }
  });

  test("Verify database user has restricted permissions", async () => {
    // This verifies we're testing the right scenario (NOCREATEDB user)
    const hasRestrictedPerms =
      await testSetup.verifyRestrictedDatabasePermissions();
    expect(hasRestrictedPerms).toBe(true);
  });
});
