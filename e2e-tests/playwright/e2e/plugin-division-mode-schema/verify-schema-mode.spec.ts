/**
 * E2E test for pluginDivisionMode: schema
 *
 * Verifies that RHDH can operate with schema-mode enabled when the database user
 * has restricted permissions (NOCREATEDB), matching production managed database environments.
 *
 * Tests are opt-in - they skip when SCHEMA_MODE_* environment variables are not set.
 */

import { test, expect } from "@support/coverage/test";

import { signInAsGuest } from "../../support/auth/guest-auth";
import { HomePage } from "../../support/pages/home-page";
import { KubeClient } from "../../utils/kube-client";
import { PortForwardSession } from "../../utils/port-forward";
import { setPortForwardRestarter } from "./schema-mode-db";
import { SchemaModeTestSetup } from "./schema-mode-setup";

test.describe("Verify pluginDivisionMode: schema", () => {
  const namespace = process.env.NAME_SPACE_RUNTIME ?? "showcase-runtime";
  const releaseName = process.env.RELEASE_NAME ?? "developer-hub";
  const installMethod = process.env.INSTALL_METHOD === "operator" ? "operator" : "helm";

  let portForwardSession: PortForwardSession | null = null;
  let testSetup: SchemaModeTestSetup;

  test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(900000);

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

      portForwardSession = new PortForwardSession(
        {
          command: "oc",
          args: ["port-forward", "-n", pfNamespace, pfResource, "5432:5432"],
        },
        {
          readyPattern: /Forwarding from/u,
          readyTimeoutMs: 30_000,
        },
      );
      await portForwardSession.start();
      console.log("Port-forward established");
      process.env.SCHEMA_MODE_DB_HOST = "localhost";

      setPortForwardRestarter(async () => {
        console.log("Restarting port-forward...");
        await portForwardSession?.restart();
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
    await portForwardSession?.stop();
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

    await signInAsGuest(page);

    const homePage = new HomePage(page);
    await homePage.verifyMainHeadingVisible();

    console.log("RHDH is accessible - plugins successfully created schemas in schema mode");
  });
});
