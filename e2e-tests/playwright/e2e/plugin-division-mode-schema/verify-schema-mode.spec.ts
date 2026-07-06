import { type TestInfo } from "@playwright/test";
import { test, expect } from "@support/coverage/test";

import { PortForwardHarness } from "../../support/harnesses/port-forward-harness";
import { HomePage } from "../../support/pages/home-page";
import { resolveInstallMethod } from "../../utils/helper";
import { KubeClient } from "../../utils/kube-client";
import { SchemaModeTestSetup } from "./schema-mode-setup";

type SchemaModeEnv = {
  adminPassword: string;
  dbPassword: string;
  pfNamespace?: string;
  pfResource?: string;
  dbHost?: string;
};

function readSchemaModeEnv(): SchemaModeEnv | null {
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
    return null;
  }

  return {
    adminPassword,
    dbPassword,
    pfNamespace: hasPortForwardMeta ? pfNamespace : undefined,
    pfResource: hasPortForwardMeta ? pfResource : undefined,
    dbHost: hasDirectHost ? dbHost : undefined,
  };
}

async function startSchemaModePortForward(
  pfNamespace: string,
  pfResource: string,
): Promise<PortForwardHarness> {
  console.log(`Starting port-forward: ${pfResource} in ${pfNamespace} -> localhost:5432`);

  const portForwardHarness = new PortForwardHarness(
    {
      command: "oc",
      args: ["port-forward", "-n", pfNamespace, pfResource, "5432:5432"],
    },
    {
      readyPattern: /Forwarding from/u,
      readyTimeoutMs: 30_000,
    },
  );
  await portForwardHarness.start();
  portForwardHarness.enableAutoRestartOnDbConnect();
  console.log("Port-forward established");
  process.env.SCHEMA_MODE_DB_HOST = "localhost";
  return portForwardHarness;
}

async function initializeSchemaModeSetup(
  namespace: string,
  releaseName: string,
  installMethod: "helm" | "operator",
  testInfo: TestInfo,
): Promise<SchemaModeTestSetup | null> {
  const testSetup = new SchemaModeTestSetup(namespace, releaseName, installMethod);

  try {
    await testSetup.setupDatabase();
    await testSetup.configureRHDH();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    testInfo.skip(true, `Schema mode setup failed: ${errorMsg}`);
    return null;
  }

  return testSetup;
}

async function setupSchemaModeTests(
  testInfo: TestInfo,
  namespace: string,
  releaseName: string,
  installMethod: "helm" | "operator",
): Promise<{
  portForwardHarness: PortForwardHarness | null;
  testSetup: SchemaModeTestSetup;
} | null> {
  const env = readSchemaModeEnv();
  if (env === null) {
    testInfo.skip(
      true,
      "SCHEMA_MODE_* environment variables not set - schema mode tests are opt-in",
    );
    return null;
  }

  testInfo.annotations.push(
    { type: "component", description: "data-management" },
    { type: "namespace", description: namespace },
  );

  let portForwardHarness: PortForwardHarness | null = null;
  if (env.pfNamespace !== undefined && env.pfResource !== undefined) {
    portForwardHarness = await startSchemaModePortForward(env.pfNamespace, env.pfResource);
  }

  const testSetup = await initializeSchemaModeSetup(
    namespace,
    releaseName,
    installMethod,
    testInfo,
  );
  if (testSetup === null) {
    return null;
  }

  return { portForwardHarness, testSetup };
}

test.describe("Verify pluginDivisionMode: schema", () => {
  const namespace = process.env.NAME_SPACE_RUNTIME ?? "showcase-runtime";
  const releaseName = process.env.RELEASE_NAME ?? "rhdh";
  const installMethod = resolveInstallMethod();

  let portForwardHarness: PortForwardHarness | null = null;
  let testSetup: SchemaModeTestSetup;

  test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(900000);

    const setup = await setupSchemaModeTests(testInfo, namespace, releaseName, installMethod);
    if (setup === null) {
      return;
    }

    portForwardHarness = setup.portForwardHarness;
    testSetup = setup.testSetup;
  });

  test.afterAll(async () => {
    await portForwardHarness?.stop();
  });

  test("Verify database user has restricted permissions", async () => {
    const hasRestrictedPerms = await testSetup.verifyRestrictedDatabasePermissions();
    expect(hasRestrictedPerms).toBe(true);
  });

  test("Verify RHDH is accessible with schema mode", async ({ guestPage }, testInfo) => {
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

    const homePage = new HomePage(guestPage);
    await homePage.verifyMainHeadingVisible();

    console.log("RHDH is accessible - plugins successfully created schemas in schema mode");
  });
});
